Transfer Between Subaccounts
cURL

```
curl --request POST \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/subaccounts/transfer \
  --header 'Content-Type: application/json' \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>' \
  --data '
{
  "client_transfer_id": "3c90c3cc-0d44-4b50-8888-8dd25736052a",
}
'
```

200

`{}`

portfolio

Transfers funds between the authenticated user’s subaccounts. Use 0 for the primary account, or 1-32 for numbered subaccounts.

POST

/

portfolio

/

subaccounts

/

transfer

Transfer Between Subaccounts

{
  "client_transfer_id": "3c90c3cc-0d44-4b50-8888-8dd25736052a",
}
'
```

`{}`

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

client_transfer_id

string<uuid>

required

Unique client-provided transfer ID for idempotency.

from_subaccount

integer

required

Source subaccount number (0 for primary, 1-32 for numbered subaccounts).

to_subaccount

integer

required

Destination subaccount number (0 for primary, 1-32 for numbered subaccounts).

amount_cents

integer<int64>

required

Amount to transfer in cents.

#### Response

application/json

Transfer completed successfully

Empty response indicating successful transfer.