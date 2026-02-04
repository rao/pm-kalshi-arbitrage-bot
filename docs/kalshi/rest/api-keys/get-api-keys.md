Get API Keys
cURL

```
curl --request GET \
  --url https://api.elections.kalshi.com/trade-api/v2/api_keys \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

```
{
  "api_keys": [
    {
      "api_key_id": "<string>",
    }
  ]
}
```

api-keys

Endpoint for retrieving all API keys associated with the authenticated user. API keys allow programmatic access to the platform without requiring username/password authentication. Each key has a unique identifier and name.

GET

/

api_keys

Get API Keys

    }
  ]
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

List of API keys retrieved successfully

api_keys

object[]

required

List of all API keys associated with the user

Show child attributes