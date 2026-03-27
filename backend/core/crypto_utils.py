import base64
import json
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.exceptions import InvalidSignature

def _normalize_for_signature(value):
    """
    Canonicalize data so JSON serialization is consistent across:
    - int vs float representations (e.g. 9 vs 9.0)
    - nested dictionaries/lists.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        if value.is_integer():
            return int(value)
        return value
    if isinstance(value, dict):
        return {k: _normalize_for_signature(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_for_signature(v) for v in value]
    return value

def generate_keypair():
    """Generates an RSA keypair and returns them as PEM strings."""
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    public_key = private_key.public_key()

    priv_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()
    ).decode('utf-8')

    pub_pem = public_key.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode('utf-8')

    return priv_pem, pub_pem

def sign_data(private_key_pem: str, data: dict) -> str:
    """Signs a dictionary of data using the private key and returns a base64 signature."""
    # Serialize data deterministically
    normalized = _normalize_for_signature(data)
    message = json.dumps(normalized, sort_keys=True).encode('utf-8')
    
    private_key = serialization.load_pem_private_key(
        private_key_pem.encode('utf-8'),
        password=None
    )
    
    signature = private_key.sign(
        message,
        padding.PSS(
            mgf=padding.MGF1(hashes.SHA256()),
            salt_length=padding.PSS.MAX_LENGTH
        ),
        hashes.SHA256()
    )
    return base64.b64encode(signature).decode('utf-8')

def verify_signature(public_key_pem: str, data: dict, signature_b64: str) -> bool:
    """Verifies the base64 signature of the data using the public key."""
    try:
        normalized = _normalize_for_signature(data)
        message = json.dumps(normalized, sort_keys=True).encode('utf-8')
        signature = base64.b64decode(signature_b64.encode('utf-8'))
        
        public_key = serialization.load_pem_public_key(
            public_key_pem.encode('utf-8')
        )
        
        public_key.verify(
            signature,
            message,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.MAX_LENGTH
            ),
            hashes.SHA256()
        )
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False
