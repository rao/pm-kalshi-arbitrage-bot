Get Milestone
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/milestones/{milestone_id}
```

200

```
{
  "milestone": {
    "id": "<string>",
  }
```

milestone

Endpoint for getting data about a specific milestone by its ID.

GET

/

milestones

/

{milestone_id}

Get Milestone

  }
```

#### Path Parameters

milestone_id

string

required

Milestone ID

#### Response

200

application/json

Milestone retrieved successfully

milestone

object

required

The milestone data.

Show child attributes