Websockets
WebSocket Connection
Messages
Subscribe Command

```
{
  "id": 1,
  }
```

Unsubscribe Command

```
{
  "id": 124,
  }
```

List Subscriptions Command

```
{
  "id": 3,
}
```

Update Subscription - Add Markets

```
{
  "id": 124,
  }
```

Update Subscription - Delete Markets

```
{
  "id": 125,
  }
```

Update Subscription - Single SID Format

```
{
  "id": 126,
  }
```

Subscribed Response

```
{
  "id": 1,
  }
```

Unsubscribed Response

```
{
  "id": 102,
}
```

OK Response

```
{
  "id": 123,
}
```

List Subscriptions Response

```
{
  "id": 3,
    }
  ]
}
```

Error Response

```
{
  "id": 123,
  }
```

Websockets

Main WebSocket connection endpoint. All communication happens through this single connection. Authentication is required to establish the connection; include API key headers during the WebSocket handshake. Some channels carry only public market data, but the connection itself still requires authentication. Use the subscribe command to subscribe to specific data channels. For more information, see the [Getting Started](https://docs.kalshi.com/getting_started/quick_start_websockets) guide.

WSS

wss://api.elections.kalshi.com

Messages

Subscribe Command

```
{
  "id": 1,
  }
```

Unsubscribe Command

```
{
  "id": 124,
  }
```

List Subscriptions Command

```
{
  "id": 3,
}
```

Update Subscription - Add Markets

```
{
  "id": 124,
  }
```

Update Subscription - Delete Markets

```
{
  "id": 125,
  }
```

Update Subscription - Single SID Format

```
{
  "id": 126,
  }
```

Subscribed Response

```
{
  "id": 1,
  }
```

Unsubscribed Response

```
{
  "id": 102,
}
```

OK Response

```
{
  "id": 123,
}
```

List Subscriptions Response

```
{
  "id": 3,
    }
  ]
}
```

Error Response

```
{
  "id": 123,
  }
```