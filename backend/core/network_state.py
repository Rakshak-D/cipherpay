class NetworkState:
    def __init__(self):
        self.mode = "centralized"

    def set_mode(self, mode: str) -> str:
        normalized = (mode or "").strip().lower()
        if normalized not in {"centralized", "blockchain"}:
            raise ValueError("Unsupported network mode.")
        self.mode = normalized
        return self.mode

    @property
    def is_blockchain_mode(self) -> bool:
        return self.mode == "blockchain"


network_state = NetworkState()
