# CipherPay

CipherPay is a full-stack payment operations demo that compares vulnerable centralized clearing with protected blockchain-backed settlement. It is designed as a security-focused training and product prototype: operators can send transfers, simulate attacks, inspect wallet impact, and review ledger continuity after tampering.

## What This Project Does

- Runs payment transfers in two modes:
  - `centralized` for direct database-backed clearing
  - `blockchain` for signed, replay-protected settlement
- Shows wallet balances from explicit sources:
  - spendable balance
  - database balance
  - chain balance
  - balance difference
- Separates normal payment operations from training-mode attack simulation
- Records one primary payment outcome per user action and links any blocked or applied security events to that payment
- Supports forensic ledger review, historical tamper simulation, and continuity recovery

## Main Features

### Payments Desk
- Create transfer requests between wallets
- Use payment templates for common flows
- Get truthful outcomes:
  - `success`
  - `rejected`
  - `partial_protected`
  - `intercepted`

### Operations
- View spendable and diagnostic balances
- Reset ledger state
- Clear transaction history
- Update wallet balances and optionally re-anchor the ledger

### Training Mode
- Enable attack simulations:
  - MITM
  - replay
  - tamper
  - insider DB drift
- Apply guided scenarios
- Review security logs and recent audited admin actions

### Ledger Explorer
- Inspect blockchain blocks and archived epochs
- Simulate historical tampering
- Start a continuity epoch from the last trusted block
- Recover the ledger from forensic mode

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, Tailwind CSS, Lucide React |
| Backend | FastAPI, SQLAlchemy, WebSockets |
| Database | SQLite |
| Cryptography | RSA signing and verification via `cryptography` |
| Ledger | Custom Python blockchain engine |

## Project Structure

```text
cipherpay/
├─ backend/
│  ├─ core/
│  ├─ routers/
│  ├─ tests/
│  ├─ database.py
│  ├─ main.py
│  ├─ models.py
│  ├─ seed.py
│  └─ services.py
├─ frontend/
│  ├─ public/
│  ├─ src/
│  ├─ tests/
│  └─ package.json
├─ README.md
├─ LICENSE
└─ .gitignore
```

## Local Setup

### Backend

1. Create a virtual environment:

```powershell
python -m venv backend/venv
```

2. Activate it:

```powershell
backend\venv\Scripts\activate
```

3. Install dependencies:

```powershell
pip install -r backend/requirements.txt
```

4. Seed the app:

```powershell
python -m backend.seed
```

5. Start the API:

```powershell
python -m uvicorn backend.main:app --reload --port 8000
```

### Frontend

1. Open a second terminal
2. Install dependencies:

```powershell
cd frontend
npm install
```

3. Start the UI:

```powershell
npm run dev
```

4. Open:

```text
http://localhost:5173
```

The frontend expects the backend at `http://localhost:8000` by default. Override it with `VITE_API_BASE_URL` if needed.

## Default Accounts

Seeded users come from backend settings and include:

- `admin` / `admin123`
- `alice` / `operator123`
- `bob` / `viewer123`
- `charlie` / `viewer123`
- `dave` / `viewer123`

## Security Model In This Demo

### Centralized Mode
- Uses the operational database as the source of truth
- Is intentionally vulnerable to simulated interception and balance drift attacks

### Blockchain Mode
- Signs transfers before submission
- Rejects tampered or invalid payloads
- Prevents duplicate settlement by transaction UUID
- Derives trusted balances from the ledger instead of the database

## Testing

### Frontend

```powershell
cd frontend
npm run lint
npm test
```

### Backend

```powershell
python -m unittest backend.tests.test_payment_flow
```

## Notes

- This is a local-first prototype and training environment, not a production banking system
- The blockchain is a custom demo ledger, not an integration with a public chain
- Generated runtime files, local databases, installed dependencies, and keys are ignored by `.gitignore`

## License

This project is licensed under the MIT License. See [`LICENSE`](/C:/RAKSHAK/CYBER%20BLOCK/cipherpay/LICENSE).
