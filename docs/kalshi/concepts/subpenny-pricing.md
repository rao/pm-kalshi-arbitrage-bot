Subpenny Pricing
*   [Making Your First Request](https://docs.kalshi.com/getting_started/making_your_first_request)
*   [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env)
*   [API Keys](https://docs.kalshi.com/getting_started/api_keys)

*   [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits)

*   [Understanding Pagination](https://docs.kalshi.com/getting_started/pagination)

*   [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses)

*   [Subpenny Pricing](https://docs.kalshi.com/getting_started/subpenny_pricing)

*   [Fixed-Point Contracts](https://docs.kalshi.com/getting_started/fixed_point_contracts)

*   [Kalshi Glossary](https://docs.kalshi.com/getting_started/terms)

On this page
*   [Format](https://docs.kalshi.com/getting_started/subpenny_pricing#format)
*   [Motivation](https://docs.kalshi.com/getting_started/subpenny_pricing#motivation)
*   [Status](https://docs.kalshi.com/getting_started/subpenny_pricing#status)

Understanding Kalshi subpenny pricing.

Format
----------------------------------------------------------------------------

Report incorrect code

```
{
    "price": 12,              // legacy: cents
}
```

Starting soon in the API, you will begin to see prices and money represented in 2 different formats: integer cents (legacy) and fixed-point dollars (new). A fixed-point dollar is a string bearing a fixed-point representation of money accurate to at least 4 decimal points.

Motivation
------------------------------------------------------------------------------------

Subpenny pricing will allow for more accurate pricing and the tail end of markets where likelihood of a given event are close to 100% or 0%.

Status
----------------------------------------------------------------------------

Currently the minimum tick size on all markets is still 1 cent. Additionally, all prices and money fields will continue to be available in the legacy integer cents format.However, in the near future we will be introducing sub-penny pricing on orders. As such, we will eventually the legacy integer cents format. Therefore, please update systems to parse the new fixed-point dollars fields and prepare for subpenny precision.

[Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses)[Fixed-Point Contracts](https://docs.kalshi.com/getting_started/fixed_point_contracts)