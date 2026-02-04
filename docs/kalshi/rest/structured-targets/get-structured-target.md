Get Structured Target
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/structured_targets/{structured_target_id}
```

200

```
{
  "structured_target": {
    "id": "<string>",
  }
```

structured-targets

Endpoint for getting data about a specific structured target by its ID.

GET

/

structured_targets

/

{structured_target_id}

Get Structured Target

  }
```

#### Path Parameters

structured_target_id

string

required

Structured target ID

#### Response

200

application/json

Structured target retrieved successfully

structured_target

object

Show child attributes