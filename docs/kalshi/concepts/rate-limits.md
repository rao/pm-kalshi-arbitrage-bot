Access tiers
------------
| Tier | Read | Write |
| --- | --- | --- |
| Basic | 20 per second | 10 per second |
| Advanced | 30 per second | 30 per second |
| Premier | 100 per second | 100 per second |
| Prime | 400 per second | 400 per second |

Qualification for tiers:

*   Basic: Completing signup
*   Advanced: Completing [https://kalshi.typeform.com/advanced-api](https://kalshi.typeform.com/advanced-api)
*   Premier: 3.75% of exchange traded volume in a given month
*   Prime: 7.5% of exchange traded volume in a given month

In addition to the volume targets, technical competency is a requirement for Premier/Prime access. Before providing access to the Premier/Prime tiers, the Exchange will establish that the trader/trading entity has the following requirements met:

*   Knowledge of common security practices for API usage
*   Proficiency in setting up monitoring for API usage, and ability to monitor API usage in near real-time
*   Understanding and implementation of rate limiting and throttling mechanisms imposed by the API, and the ability to self-limit load
*   Awareness of legal and compliance aspects related to API usage

Only the following APIs fall under the write limit, for the batch APIs, each item in the batch is considered 1 transaction with the sole exception of BatchCancelOrders, where each cancel counts as 0.2 transactions:

At any time, any Member that uses FIX or is at the highest possible API tier is eligible for an upgrade to its rate limit upon demonstration that such a tier is necessary for its bona fide market activity.