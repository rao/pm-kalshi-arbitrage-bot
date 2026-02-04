The Kalshi API uses cursor-based pagination to help you efficiently navigate through large datasets. This guide explains how pagination works and provides examples for handling paginated responses.
When making requests to list endpoints (like `/markets`, `/events`, or `/series`), the API returns results in pages to keep response sizes manageable. Each page contains:
*   **Data array**: The actual items for the current page (markets, events, etc.)
*   **Cursor field**: A token that points to the next page of results
*   **Limit**: The maximum number of items per page (default: 100)

Using Cursors
-------------

To paginate through results:

1.   Make your initial request without a cursor
2.   Check if the response includes a `cursor` field
3.   If a cursor exists, make another request with `?cursor={cursor_value}`
4.   Continue until the cursor is `null` (no more pages)

Example: Paginating Through Markets
-----------------------------------

Most list endpoints support these pagination parameters:

*   **`cursor`**: Token from previous response to get the next page
*   **`limit`**: Number of items per page (typically 1-100, default: 100)

Best Practices
--------------

1.   **Handle rate limits**: When paginating through large datasets, be mindful of [rate limits](https://docs.kalshi.com/getting_started/rate_limits)
2.   **Set appropriate limits**: Use smaller page sizes if you only need a few items
3.   **Cache results**: Store paginated data locally to avoid repeated API calls
4.   **Check for changes**: Data can change between requests, so consider implementing refresh logic

The following endpoints support cursor-based pagination:

Common Patterns
---------------

### Fetching Recent Items

If you only need recent items, you can limit results without pagination:

```
# Get just the 10 most recent markets
url = "https://api.elections.kalshi.com/trade-api/v2/markets?limit=10&status=open"
```

### Filtering While Paginating

You can combine filters with pagination:

```
# Get all open markets for a series
url = f"{base_url}?series_ticker={ticker}&status=open&limit=100&cursor={cursor}"
```

### Detecting New Items

To check for new items since your last fetch:

1.   Store the first item’s ID or timestamp from your previous fetch
2.   Paginate through results until you find that item
3.   Everything before it is new

Next Steps
----------

Now that you understand pagination, you can efficiently work with large datasets in the Kalshi API. For more details on specific endpoints, check the [API Reference](https://docs.kalshi.com/api-reference).