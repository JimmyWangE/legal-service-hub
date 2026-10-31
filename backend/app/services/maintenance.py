from sqlalchemy.orm import Session

from app.services.marketplace import expire_overdue_requests
from app.services.trade import auto_accept_deliveries, overdue_reminders, settle_orders


def run_due_jobs(db: Session) -> dict[str, int]:
    """按业务时限推进订单与需求状态；可重复执行，未到期的数据不会被修改。"""
    return {
        "expired_requests": expire_overdue_requests(db),
        "auto_accepted": auto_accept_deliveries(db),
        "overdue_reminded": overdue_reminders(db),
        "settled": settle_orders(db),
    }
