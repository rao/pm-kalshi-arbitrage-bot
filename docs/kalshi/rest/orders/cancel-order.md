Cancel Order
cURL

```
curl --request DELETE \
  --url https://api.elections.kalshi.com/trade-api/v2/portfolio/orders/{order_id} \
  --header 'KALSHI-ACCESS-KEY: <api-key>' \
  --header 'KALSHI-ACCESS-SIGNATURE: <api-key>' \
  --header 'KALSHI-ACCESS-TIMESTAMP: <api-key>'
```

200

500

```
{
  "order": {
    "order_id": "<string>",
}
```

orders

Endpoint for canceling orders. The value for the orderId should match the id field of the order you want to decrease. Commonly, DELETE-type endpoints return 204 status with no body content on success. But we can’t completely delete the order, as it may be partially filled already. Instead, the DeleteOrder endpoint reduce the order completely, essentially zeroing the remaining resting contracts on it. The zeroed order is returned on the response payload as a form of validation for the client.

DELETE

/

portfolio

/

orders

/

{order_id}

Cancel Order

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

#### Path Parameters

order_id

string

required

Order ID

#### Query Parameters

subaccount

integer

Subaccount number (0 for primary, 1-32 for subaccounts). If omitted, returns results across all subaccounts.

#### Response

application/json

Order cancelled successfully

order

object

required

Show child attributes

reduced_by

integer

required

reduced_by_fp

string

required

String representation of the number of contracts that were successfully canceled from this order

Example:

`"10.00"`