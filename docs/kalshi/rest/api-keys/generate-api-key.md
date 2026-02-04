Generate API Key
cURL

```
curl --request POST \
  --url https://api.elections.kalshi.com/trade-api/v2/api_keys/generate \
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
  "api_key_id": "<string>",
}
```

api-keys

Endpoint for generating a new API key with an automatically created key pair. This endpoint generates both a public and private RSA key pair. The public key is stored on the platform, while the private key is returned to the user and must be stored securely. The private key cannot be retrieved again.

POST

/

api_keys

/

generate

Generate API Key

{
  "name": "<string>",
}
'
```

  "api_key_id": "<string>",
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

scopes

string[]

List of scopes to grant to the API key. Valid values are 'read' and 'write'. If 'write' is included, 'read' must also be included. Defaults to full access (['read', 'write']) if not provided.

#### Response

201

application/json

API key generated successfully

api_key_id

string

required

Unique identifier for the newly generated API key

private_key

string

required

RSA private key in PEM format. This must be stored securely and cannot be retrieved again after this response