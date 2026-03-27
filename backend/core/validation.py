from decimal import Decimal, InvalidOperation

from fastapi import HTTPException


TWOPLACES = Decimal("0.01")


def normalize_currency_amount(value: float | int) -> float:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Amount must be a valid number.") from exc

    if amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero.")

    if amount.as_tuple().exponent < -2:
        raise HTTPException(status_code=400, detail="Amount supports at most 2 decimal places.")

    return float(amount.quantize(TWOPLACES))
