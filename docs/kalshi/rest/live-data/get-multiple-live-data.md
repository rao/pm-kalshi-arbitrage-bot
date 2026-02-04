Get Multiple Live Data
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/live_data/batch
```

200

```
{
  "live_datas": [
    {
      "type": "<string>",
    }
  ]
}
```

live-data

Get live data for multiple milestones

GET

/

live_data

/

batch

Get Multiple Live Data

    }
  ]
}
```

#### Query Parameters

milestone_ids

string[]

required

Array of milestone IDs

Maximum array length: `100`

#### Response

200

application/json

Live data retrieved successfully

live_datas

object[]

required

Show child attributes