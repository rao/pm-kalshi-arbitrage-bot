Get User Data Timestamp
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/exchange/user_data_timestamp
```

200

```
{
  "as_of_time": "2023-11-07T05:31:56Z"
}
```

exchange

There is typically a short delay before exchange events are reflected in the API endpoints. Whenever possible, combine API responses to PUT/POST/DELETE requests with websocket data to obtain the most accurate view of the exchange state. This endpoint provides an approximate indication of when the data from the following endpoints was last validated: GetBalance, GetOrder(s), GetFills, GetPositions

GET

/

exchange

/

user_data_timestamp

Get User Data Timestamp

}
```

#### Response

200

application/json

User data timestamp retrieved successfully

as_of_time

string<date-time>

required

Timestamp when user data was last updated.