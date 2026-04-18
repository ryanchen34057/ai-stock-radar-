from pydantic import BaseModel
from typing import Optional


class KLineData(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int


class StockResponse(BaseModel):
    symbol: str
    name: str
    layer: int
    layer_name: str
    sub_category: Optional[str] = None
    note: Optional[str] = None
    current_price: Optional[float] = None
    change: Optional[float] = None
    change_percent: Optional[float] = None
    volume: Optional[int] = None
    pe_ratio: Optional[float] = None
    market_cap: Optional[float] = None
    ma: dict  # keys: "5", "10", "20", "60", "120", "240"
    klines: list[KLineData]


class DashboardResponse(BaseModel):
    last_updated: str
    stocks: list[StockResponse]


class StockInfo(BaseModel):
    symbol: str
    name: str
    layer: int
    layer_name: str
    sub_category: Optional[str] = None
    note: Optional[str] = None


class LastUpdateResponse(BaseModel):
    last_updated: Optional[str]
    status: str
