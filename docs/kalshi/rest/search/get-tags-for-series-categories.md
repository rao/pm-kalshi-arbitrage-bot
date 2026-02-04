Get Tags for Series Categories
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/search/tags_by_categories
```

200

```
{
  "tags_by_categories": {}
}
```

search

Retrieve tags organized by series categories.

This endpoint returns a mapping of series categories to their associated tags, which can be used for filtering and search functionality.

GET

/

search

/

tags_by_categories

Get Tags for Series Categories

}
```

#### Response

200

application/json

Tags retrieved successfully

tags_by_categories

object

required

Mapping of series categories to their associated tags

Show child attributes