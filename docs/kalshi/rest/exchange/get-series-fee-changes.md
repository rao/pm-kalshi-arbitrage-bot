Get Series Fee Changes
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/series/fee_changes
```

200

500

```
{
  "series_fee_change_arr": [
    {
      "id": "<string>",
    }
  ]
}
```

exchange

GET

/

series

/

fee_changes

Get Series Fee Changes

    }
  ]
}
```

#### Query Parameters

series_ticker

string

show_historical

boolean

default:false

#### Response

application/json

Series fee changes retrieved successfully

series_fee_change_arr

object[]

required

Show child attributes