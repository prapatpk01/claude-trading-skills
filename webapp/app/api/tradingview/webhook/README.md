# TradingView webhook integration placeholder

Sentinel can receive TradingView alert webhooks through a dedicated authenticated POST route. The production route should verify a server-side secret, normalize the inbound alert, write an audit record, and pass the signal into research/monitoring only. It must not bypass Funding, Risk, CIO, or human approval gates.

Recommended flow:

TradingView Alert -> HTTPS Webhook -> Sentinel -> Signal/Audit -> Research or Holdings Monitor -> Funding/Risk/CIO -> Human approval

Do not place brokerage credentials in TradingView alert payloads.
