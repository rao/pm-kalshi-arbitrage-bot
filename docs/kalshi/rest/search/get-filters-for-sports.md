Get Filters for Sports
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/search/filters_by_sport
```

200

```
{
  "filters_by_sports": {},
}
```

search

Retrieve available filters organized by sport.

This endpoint returns filtering options available for each sport, including scopes and competitions. It also provides an ordered list of sports for display purposes.

GET

/

search

/

filters_by_sport

Get Filters for Sports

}
```

#### Response

200

application/json

Filters retrieved successfully

filters_by_sports

object

required

Mapping of sports to their filter details

Show child attributes

sport_ordering

string[]

required

Ordered list of sports for display