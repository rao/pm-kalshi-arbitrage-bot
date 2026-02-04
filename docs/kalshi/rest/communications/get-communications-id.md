Get Communications ID
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/communications/id \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "communications_id": "<string>"
}
```

communications

Endpoint for getting the communications ID of the logged-in user.

GET

/

communications

/

id

Get Communications ID

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

application/json

Communications ID retrieved successfully

communications_id

string

required

A public communications ID which is used to identify the user