class DomainError(Exception):
    def __init__(self, message: str, status_code: int = 400, code: str = "business_error"):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


def require(condition: bool, message: str, status_code: int = 400, code: str = "business_error"):
    if not condition:
        raise DomainError(message, status_code, code)
