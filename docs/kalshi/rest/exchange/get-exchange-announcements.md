Get Exchange Announcements
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/exchange/announcements
```

200

```
{
  "announcements": [
    {
      "type": "info",
    }
  ]
}
```

exchange

Endpoint for getting all exchange-wide announcements.

GET

/

exchange

/

announcements

Get Exchange Announcements

    }
  ]
}
```

#### Response

200

application/json

Exchange announcements retrieved successfully

announcements

object[]

required

A list of exchange-wide announcements.

Show child attributes