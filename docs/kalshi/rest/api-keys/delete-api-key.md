Delete API Key
cURL

```
curl --request DELETE \
  --url https://api.elections.kalshi.com/trade-api/v2/api_keys/{api_key} \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

api-keys

Endpoint for deleting an existing API key. This endpoint permanently deletes an API key. Once deleted, the key can no longer be used for authentication. This action cannot be undone.

DELETE

/

api_keys

/

{api_key}

Delete API Key

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

#### Path Parameters

api_key

string

required

API key ID to delete

#### Response

204

API key successfully deleted