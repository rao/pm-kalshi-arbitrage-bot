Create API Key
cURL

```
curl --request POST \
  --url https://api.elections.kalshi.com/trade-api/v2/api_keys \
  --header 'Content-Type: application/json' \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>' \
  --data '
{
  "name": "<string>",
}
'
```

201

```
{
  "api_key_id": "<string>"
}
```

api-keys

Endpoint for creating a new API key with a user-provided public key. This endpoint allows users with Premier or Market Maker API usage levels to create API keys by providing their own RSA public key. The platform will use this public key to verify signatures on API requests.

POST

/

api_keys

Create API Key

{
  "name": "<string>",
}
'
```

  "api_key_id": "<string>"
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

#### Body

application/json

name

string

required

Name for the API key. This helps identify the key's purpose

public_key

string

required

RSA public key in PEM format. This will be used to verify signatures on API requests

scopes

string[]

List of scopes to grant to the API key. Valid values are 'read' and 'write'. If 'write' is included, 'read' must also be included. Defaults to full access (['read', 'write']) if not provided.

#### Response

201

application/json

API key created successfully

api_key_id

string

required

Unique identifier for the newly created API key