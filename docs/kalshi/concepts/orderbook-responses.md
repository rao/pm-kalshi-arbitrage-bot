Orderbook Responses
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
*   [Getting Orderbook Data](https://docs.kalshi.com/getting_started/orderbook_responses#getting-orderbook-data)
*   [Request Format](https://docs.kalshi.com/getting_started/orderbook_responses#request-format)
*   [Example Request](https://docs.kalshi.com/getting_started/orderbook_responses#example-request)
*   [Response Structure](https://docs.kalshi.com/getting_started/orderbook_responses#response-structure)
*   [Example Response](https://docs.kalshi.com/getting_started/orderbook_responses#example-response)
*   [Understanding the Arrays](https://docs.kalshi.com/getting_started/orderbook_responses#understanding-the-arrays)
*   [Why Only Bids?](https://docs.kalshi.com/getting_started/orderbook_responses#why-only-bids)
*   [The Reciprocal Relationship](https://docs.kalshi.com/getting_started/orderbook_responses#the-reciprocal-relationship)
*   [Calculating Spreads](https://docs.kalshi.com/getting_started/orderbook_responses#calculating-spreads)
*   [Example Calculation](https://docs.kalshi.com/getting_started/orderbook_responses#example-calculation)
*   [Working with Orderbook Data](https://docs.kalshi.com/getting_started/orderbook_responses#working-with-orderbook-data)
*   [Display Best Prices](https://docs.kalshi.com/getting_started/orderbook_responses#display-best-prices)
*   [Calculate Market Depth](https://docs.kalshi.com/getting_started/orderbook_responses#calculate-market-depth)
*   [Next Steps](https://docs.kalshi.com/getting_started/orderbook_responses#next-steps)

Understanding Kalshi orderbook structure and binary prediction market mechanics

Getting Orderbook Data
---------------------------------------------------------------------------------------------------------------

The [Get Market Orderbook](https://docs.kalshi.com/api-reference/market/get-market-order-book) endpoint returns the current state of bids for a specific market.
### 

Request Format

Report incorrect code

```
GET /markets/{ticker}/orderbook
```

No authentication is required for this endpoint.
### 

Example Request

Python

JavaScript

cURL

Report incorrect code

```
import requests

# Get orderbook for a specific market
market_ticker = "KXHIGHNY-24JAN01-T60"
url = f"https://api.elections.kalshi.com/trade-api/v2/markets/{market_ticker}/orderbook"

response = requests.get(url)
orderbook_data = response.json()
```

Response Structure
-------------------------------------------------------------------------------------------------------

The orderbook response contains two arrays of bids - one for YES positions and one for NO positions. Each bid is represented as a two-element array: `[price, quantity]`.
### 

Example Response

Report incorrect code

```
{
  "orderbook": {
    "yes": [
      [1, 200],    // 200 contracts bid at 1¢
      [15, 100],   // 100 contracts bid at 15¢
      [20, 50],    // 50 contracts bid at 20¢
      [25, 20],    // 20 contracts bid at 25¢
      [30, 11],    // 11 contracts bid at 30¢
      [31, 10],    // 10 contracts bid at 31¢
      [32, 10],    // 10 contracts bid at 32¢
      [33, 11],    // 11 contracts bid at 33¢
      [34, 9],     // 9 contracts bid at 34¢
      [35, 11],    // 11 contracts bid at 35¢
      [41, 10],    // 10 contracts bid at 41¢
      [42, 13]     // 13 contracts bid at 42¢
    ],
  }
```

### 

Understanding the Arrays

*   **First element**: Price in cents (1-99)
*   **Second element**: Number of contracts available at that price
*   Arrays are sorted by price in **ascending order**
*   The **highest** bid (best bid) is the **last** element in each array

Why Only Bids?
----------------------------------------------------------------------------------------------

**Important**: Kalshi’s orderbook only returns bids, not asks. This is because in binary prediction markets, there’s a reciprocal relationship between YES and NO positions.

In binary prediction markets, every position has a complementary opposite:
*   A **YES BID** at price X is equivalent to a **NO ASK** at price (100 - X)
*   A **NO BID** at price Y is equivalent to a **YES ASK** at price (100 - Y)

### 

The Reciprocal Relationship

Since binary markets must sum to 100¢, these relationships always hold:

| Action | Equivalent To | Why |
| --- | --- | --- |
| YES BID at 60¢ | NO ASK at 40¢ | Willing to pay 60¢ for YES = Willing to receive 40¢ to take NO |
| NO BID at 30¢ | YES ASK at 70¢ | Willing to pay 30¢ for NO = Willing to receive 70¢ to take YES |

This reciprocal nature means that by showing only bids, the orderbook provides complete market information while avoiding redundancy.

Calculating Spreads
---------------------------------------------------------------------------------------------------------

To find the bid-ask spread for a market:
1.   **YES spread**:
    *   Best YES bid: Highest price in the `yes` array
    *   Best YES ask: 100 - (Highest price in the `no` array)
    *   Spread = Best YES ask - Best YES bid

2.   **NO spread**:
    *   Best NO bid: Highest price in the `no` array
    *   Best NO ask: 100 - (Highest price in the `yes` array)
    *   Spread = Best NO ask - Best NO bid

### 

Example Calculation

Report incorrect code

```
# Using the example orderbook above
best_yes_bid = 42  # Highest YES bid (last in array)
best_yes_ask = 100 - 56  # 100 - highest NO bid = 44

spread = best_yes_ask - best_yes_bid  # 44 - 42 = 2

# The spread is 2¢
# You can buy YES at 44¢ (implied ask) and sell at 42¢ (bid)
```

Working with Orderbook Data
-------------------------------------------------------------------------------------------------------------------------

### 

Display Best Prices

Python

JavaScript

Report incorrect code

```
def display_best_prices(orderbook_data):
    """Display the best bid prices and implied asks"""
    orderbook = orderbook_data['orderbook']

    # Best bids (if any exist)
    if orderbook['yes']:
        best_yes_bid = orderbook['yes'][-1][0]  # Last element is highest
        print(f"Best YES Bid: {best_yes_bid}¢")

    if orderbook['no']:
        best_no_bid = orderbook['no'][-1][0]  # Last element is highest
        best_yes_ask = 100 - best_no_bid
        print(f"Best YES Ask: {best_yes_ask}¢ (implied from NO bid)")

    print()

    if orderbook['no']:
        best_no_bid = orderbook['no'][-1][0]  # Last element is highest
        print(f"Best NO Bid: {best_no_bid}¢")

    if orderbook['yes']:
        best_yes_bid = orderbook['yes'][-1][0]  # Last element is highest
        best_no_ask = 100 - best_yes_bid
        print(f"Best NO Ask: {best_no_ask}¢ (implied from YES bid)")
```

### 

Calculate Market Depth

Report incorrect code

```
def calculate_depth(orderbook_data, depth_cents=5):
    """Calculate total volume within X cents of best bid"""
    orderbook = orderbook_data['orderbook']

    yes_depth = 0
    no_depth = 0

    # YES side depth (iterate backwards from best bid)
    if orderbook['yes']:
        best_yes = orderbook['yes'][-1][0]  # Last element is highest
        for price, quantity in reversed(orderbook['yes']):
            if best_yes - price <= depth_cents:
                yes_depth += quantity
            else:
                break

    # NO side depth (iterate backwards from best bid)
    if orderbook['no']:
        best_no = orderbook['no'][-1][0]  # Last element is highest
        for price, quantity in reversed(orderbook['no']):
            if best_no - price <= depth_cents:
                no_depth += quantity
            else:
                break

    return {"yes_depth": yes_depth, "no_depth": no_depth}
```

Next Steps
---------------------------------------------------------------------------------------

*   Learn about [making authenticated requests](https://docs.kalshi.com/getting_started/api_keys) to place orders
*   Explore [WebSocket connections](https://docs.kalshi.com/websockets/orderbook-updates) for real-time orderbook updates
*   Read about [market mechanics](https://kalshi.com/learn) on the Kalshi website

[Understanding Pagination](https://docs.kalshi.com/getting_started/pagination)[Subpenny Pricing](https://docs.kalshi.com/getting_started/subpenny_pricing)