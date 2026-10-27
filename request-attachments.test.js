import assert from "node:assert/strict";
import test from "node:test";
import { RequestAttachmentSelection, renderRequestAttachments, requestAttachmentField } from "./request-attachments.js";

const file = (name, size = 128, lastModified = 1) => ({ name, size, lastModified });

test("需求附件：展示多选上传入口和隐私说明，不作为普通表单字段序列化", () => {
  const html = requestAttachmentField();
  assert.match(html, /type="file" multiple/);
  assert.match(html, /\.pdf,\.doc,\.docx,\.txt,\.png,\.jpg,\.jpeg/);
  assert.match(html, /50MB/);
  assert.match(html, /仅本人和成单律师可下载/);
  assert.doesNotMatch(html, /<input[^>]*name=/);
});

test("需求附件：多次选择可累加、去重和移除", () => {
  const selection = new RequestAttachmentSelection();
  selection.add([file("聊天截图.PNG"), file("合同.pdf")]);
  selection.add([file("合同.pdf"), file("聊天记录.txt")]);
  assert.equal(selection.entries.length, 3);
  selection.remove(1);
  assert.deepEqual(selection.entries.map((entry) => entry.file.name), ["聊天截图.PNG", "聊天记录.txt"]);
});

test("需求附件：拒绝空文件、非法格式、超大文件和超过8个文件，保留原选择", () => {
  const selection = new RequestAttachmentSelection();
  selection.add([file("证据.docx")]);
  for (const invalid of [file("空.txt", 0), file("脚本.html"), file("大文件.pdf", 50 * 1024 * 1024 + 1)]) assert.throws(() => selection.add([file("正常.txt"), invalid]));
  assert.throws(() => selection.add(Array.from({ length: 8 }, (_, index) => file(`截图${index}.png`))));
  assert.equal(selection.entries.length, 1);
});

test("需求附件：失败重试复用成功上传的ID，避免重复上传", async () => {
  const selection = new RequestAttachmentSelection();
  selection.add([file("合同.pdf"), file("聊天记录.txt")]);
  const calls = [];
  const upload = async (item) => {
    calls.push(item.name);
    if (calls.length === 2) throw new Error("网络错误");
    return { id: item.name === "合同.pdf" ? "F1" : "F2" };
  };
  await assert.rejects(selection.uploadAll(upload), /网络错误/);
  assert.deepEqual(await selection.uploadAll(upload), ["F1", "F2"]);
  assert.deepEqual(await selection.uploadAll(upload), ["F1", "F2"]);
  assert.deepEqual(calls, ["合同.pdf", "聊天记录.txt", "聊天记录.txt"]);
});

test("需求附件：详情转义文件名、使用专属下载按钮，未授权仅显示数量", () => {
  const item = { id: "R1", attachment_count: 1, attachments: [{ file_id: "F1", name: '<img src=x onerror="alert(1)">.txt', size: 1024 }] };
  const html = renderRequestAttachments(item);
  assert.match(html, /data-action="download-request-file"/);
  assert.match(html, /data-request-id="R1"/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  const privateHtml = renderRequestAttachments({ ...item, attachments: [] });
  assert.match(privateHtml, /成单律师/);
  assert.doesNotMatch(privateHtml, /F1|onerror|download-request-file/);
  assert.equal(renderRequestAttachments({}), "");
});
