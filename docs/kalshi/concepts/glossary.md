Kalshi Glossary
*   [Making Your First Request](https://docs.kalshi.com/getting_started/making_your_first_request)
*   [Test In The Demo Environment](https://docs.kalshi.com/getting_started/demo_env)
*   [API Keys](https://docs.kalshi.com/getting_started/api_keys)

*   [Rate Limits and Tiers](https://docs.kalshi.com/getting_started/rate_limits)

*   [Understanding Pagination](https://docs.kalshi.com/getting_started/pagination)

*   [Orderbook Responses](https://docs.kalshi.com/getting_started/orderbook_responses)

*   [Subpenny Pricing](https://docs.kalshi.com/getting_started/subpenny_pricing)

*   [Fixed-Point Contracts](https://docs.kalshi.com/getting_started/fixed_point_contracts)

*   [Kalshi Glossary](https://docs.kalshi.com/getting_started/terms)

Core terminology used in the Kalshi exchange

Here are some core terminologies used in Kalshi exchange:**Market:** A single binary market. This is a low level object which rarely will need to be exposed on its own to members. The usage of the term “market” here is consistent with how it’s used in the backend and API.**Event:** An event is a collection of markets and the basic unit that members should interact with on Kalshi.**Series:** A series is a collection of related events. The following should hold true for events that make up a series:
*   Each event should look at similar data for determination, but translated over another, disjoint time period.
*   Series should never have a logical outcome dependency between events.
*   Events in a series should have the same ticker prefix.

Please see the “Timeline and Payout” dropdown on a market’s page to find the Market, Event, and Series tickers. Note that the market ticker will depend on which market you are looking at on that page. For example, Trump and Harris are each their own market.

[Fixed-Point Contracts](https://docs.kalshi.com/getting_started/fixed_point_contracts)