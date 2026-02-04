Get Live Data
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/live_data/{type}/milestone/{milestone_id}
```

200

```
{
  "live_data": {
    "type": "<string>",
  }
```

live-data

Get live data for a specific milestone

GET

/

live_data

/

{type}

/

milestone

/

{milestone_id}

Get Live Data

  }
```

#### Path Parameters

type

string

required

Type of live data

milestone_id

string

required

Milestone ID

#### Response

200

application/json

Live data retrieved successfully

live_data

object

required

Show child attributes