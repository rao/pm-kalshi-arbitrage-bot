Get Exchange Status
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/exchange/status
```

200

503

504

```
{
  "exchange_active": true,
}
```

exchange

Endpoint for getting the exchange status.

GET

/

exchange

/

status

Get Exchange Status

503

504

```
{
  "exchange_active": true,
}
```

#### Response

application/json

Exchange status retrieved successfully

exchange_active

boolean

required

False if the core Kalshi exchange is no longer taking any state changes at all. This includes but is not limited to trading, new users, and transfers. True unless we are under maintenance.

trading_active

boolean

required

True if we are currently permitting trading on the exchange. This is true during trading hours and false outside exchange hours. Kalshi reserves the right to pause at any time in case issues are detected.

exchange_estimated_resume_time

string<date-time> | null

Estimated downtime for the current exchange maintenance window. However, this is not guaranteed and can be extended.