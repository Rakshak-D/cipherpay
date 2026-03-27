PAYMENT_TEMPLATES = {
    "treasury-topup": {
        "id": "treasury-topup",
        "payment_type": "treasury_topup",
        "label": "Treasury top-up",
        "description": "Move working capital from the bank treasury into an operator wallet before payouts begin.",
        "reference_prefix": "TOPUP",
        "default_sender_id": 1,
        "default_recipient_id": 2,
        "default_amount": 2500.0,
        "business_context": "Treasury is funding an operational wallet so downstream payouts can be executed safely.",
    },
    "merchant-payout": {
        "id": "merchant-payout",
        "payment_type": "merchant_payout",
        "label": "Merchant payout",
        "description": "Settle a merchant or seller account after completed order volume is batched for payout.",
        "reference_prefix": "MERCH",
        "default_sender_id": 1,
        "default_recipient_id": 4,
        "default_amount": 1850.0,
        "business_context": "Treasury is releasing batched settlement funds to a merchant after platform reconciliation.",
    },
    "vendor-reimbursement": {
        "id": "vendor-reimbursement",
        "payment_type": "vendor_reimbursement",
        "label": "Vendor reimbursement",
        "description": "Reimburse an operational vendor or device partner for approved expenses or service credits.",
        "reference_prefix": "VEND",
        "default_sender_id": 2,
        "default_recipient_id": 3,
        "default_amount": 640.0,
        "business_context": "An operator is reimbursing a partner/vendor after approval checks were completed.",
    },
    "customer-refund": {
        "id": "customer-refund",
        "payment_type": "customer_refund",
        "label": "Customer refund",
        "description": "Return money to an end user after a cancellation, dispute resolution, or failed service event.",
        "reference_prefix": "RFND",
        "default_sender_id": 1,
        "default_recipient_id": 3,
        "default_amount": 320.0,
        "business_context": "The platform is refunding a customer after a service reversal or dispute outcome.",
    },
    "contractor-payroll": {
        "id": "contractor-payroll",
        "payment_type": "contractor_payroll",
        "label": "Contractor payroll",
        "description": "Disburse scheduled payroll or stipends from treasury to an approved contractor wallet.",
        "reference_prefix": "PAY",
        "default_sender_id": 1,
        "default_recipient_id": 2,
        "default_amount": 1200.0,
        "business_context": "Treasury is disbursing a scheduled payroll or stipend payment to an approved payee.",
    },
}


def list_payment_templates():
    return list(PAYMENT_TEMPLATES.values())


def resolve_payment_template(template_id: str | None):
    if template_id and template_id in PAYMENT_TEMPLATES:
        return PAYMENT_TEMPLATES[template_id]
    return None


def build_payment_metadata(
    *,
    template_id: str | None,
    tx_id: str,
    sender_name: str,
    recipient_name: str,
):
    template = resolve_payment_template(template_id)
    if template:
        return {
            "payment_type": template["payment_type"],
            "payment_label": template["label"],
            "reference_label": f"{template['reference_prefix']}-{tx_id[:8].upper()}",
            "business_context": template["business_context"],
        }

    return {
        "payment_type": "operational_transfer",
        "payment_label": "Operational transfer",
        "reference_label": f"OPS-{tx_id[:8].upper()}",
        "business_context": (
            f"Funds are being moved from {sender_name} to {recipient_name} through the current settlement rail."
        ),
    }

