Get Account API Limits
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/account/limits \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

```
{
  "usage_tier": "<string>",
}
```

account

Endpoint to retrieve the API tier limits associated with the authenticated user.

GET

/

account

/

limits

Get Account API Limits

}
```

#### Authorizations

KALSHI-ACCESS-KEY

string

header

required

Your API key ID

KALSHI-ACCESS-SIGNATURE

string

header

required

RSA-PSS signature of the request

KALSHI-ACCESS-TIMESTAMP

string

header

required

Request timestamp in milliseconds

#### Response

200

application/json

Account API tier limits retrieved successfully

usage_tier

string

required

User's API usage tier

read_limit

integer

required

Maximum read requests per second

write_limit

integer

required

Maximum write requests per second