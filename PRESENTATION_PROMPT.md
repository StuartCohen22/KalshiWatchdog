# Kalshi Watchdog Presentation Prompt

Create a professional hackathon presentation for "Kalshi Watchdog" - a real-time prediction market surveillance platform. The presentation should be 10-15 slides in Markdown format suitable for conversion to slides (using Marp, reveal.js, or similar).

## Presentation Structure:

### Slide 1: Title
- Project name: Kalshi Watchdog
- Tagline: "Real-time surveillance for prediction market integrity"
- Team info: ECU ACM Spark / AWS Track Hackathon
- Live demo link: https://kalshiwatchdog.me

### Slide 2-3: What Are Prediction Markets?
- Definition: Financial markets where participants trade contracts based on future event outcomes
- Kalshi is the first CFTC-regulated prediction market exchange in the US (launched 2021)
- Real statistics:
  - Kalshi processed over $500 million in trading volume in 2023
  - Polymarket (unregulated competitor) exceeded $2 billion in 2024
  - Prediction markets are projected to reach $10+ billion by 2026
  - Markets cover elections, economics, sports, entertainment, policy decisions
- How they work: Binary contracts (YES/NO) that settle at $1 or $0 based on real-world outcomes
- Example: "Will inflation exceed 3% in Q1 2024?" trades at 65¢ = 65% implied probability

### Slide 4: The Insider Trading Problem
- Why it matters: Prediction markets derive value from aggregating public information
- Insider trading destroys market integrity and price discovery
- Real-world impact:
  - 2024 Polymarket scandal: Trader made $20M on Trump election outcome with suspicious timing
  - Congressional trading: Members of Congress trading on non-public policy information
  - Corporate insiders: Employees betting on merger announcements before public disclosure
- Regulatory gap: Traditional securities have SEC oversight; prediction markets are nascent
- Detection challenge: High-frequency trading, small position sizes, coordinated activity across accounts

### Slide 5: The Problem We're Solving
- Manual surveillance is impossible at scale (thousands of markets, millions of trades)
- Existing tools focus on traditional securities, not prediction markets
- Need: Real-time anomaly detection with AI-powered case analysis
- Our solution: Automated surveillance platform that flags suspicious patterns instantly

### Slide 6: Kalshi Watchdog Architecture
- Dual-mode operation: Local (SQLite) and Cloud (AWS)
- 13 AWS services working together
- Key components:
  - Lambda functions for serverless compute
  - DynamoDB for real-time data storage
  - Step Functions for pipeline orchestration
  - Bedrock (Claude 3 Haiku) for AI analysis
  - WebSocket for live updates
  - Cognito for authentication

### Slide 7: Detection Algorithms
Three anomaly detection methods:
1. **Volume Spike Detection**: Flags hourly volume exceeding mean + N×std
2. **Coordinated Activity**: Detects 5-minute trade clusters with directional consistency
3. **Golden Window**: Catches extreme-probability bets placed shortly before resolution

Each anomaly gets AI-generated narrative explaining the suspicious pattern

### Slide 8: AI-Powered Analysis
- Claude 3 Haiku via AWS Bedrock analyzes every flagged anomaly
- Generates:
  - Plain-English case summary
  - Severity assessment (CRITICAL, HIGH, MEDIUM, LOW)
  - Reasoning and possible explanations
  - Context-aware insights
- Example output: "High-volume coordinated burst detected 2.3 hours before resolution. Unusual clustering suggests non-independent actors with advance knowledge."

### Slide 9: Live Demo - Dashboard
Screenshot or description:
- Real-time stats bar (trades, markets, anomalies)
- Anomaly feed with severity badges
- Live detection stream (WebSocket push notifications)
- Pipeline controls (ingest, detect, analyze)
- Interactive visualizations

### Slide 10: Live Demo - Analytics
Screenshot or description:
- Force graph showing market-anomaly relationships
- Category breakdown (which market types have most anomalies)
- Severity distribution
- Timeline scatter plot (anomalies relative to resolution time)

### Slide 11: Live Demo - Anomaly Detail
Screenshot or description:
- Trade cluster visualization
- Volume/price overlay chart
- AI-generated case narrative
- Context metrics (z-score, hours before resolution, total volume)
- PDF export for case documentation

### Slide 12: Technical Highlights
- **Dual-mode architecture**: Same codebase runs locally (dev) or on AWS (prod)
- **Zero-downtime switching**: Single environment variable controls storage backend
- **Real-time push**: WebSocket (AWS) or SSE (local) for live updates
- **Serverless pipeline**: Step Functions orchestrates ingestion → detection → analysis
- **User authentication**: Cognito with admin dashboard for usage analytics
- **CI/CD**: Amplify auto-deploys from GitHub on every push

### Slide 13: Tech Stack
**Backend:** Python 3.12, AWS Lambda, DynamoDB, Step Functions, EventBridge, Bedrock (Claude 3 Haiku)
**Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Recharts, Framer Motion, AWS Amplify Auth
**Infrastructure:** AWS SAM, CloudFormation, API Gateway (REST + WebSocket), Cognito, Amplify Hosting, CloudWatch, X-Ray
**Data:** Kalshi API (RSA-signed), SQLite (local), DynamoDB (cloud), DynamoDB Streams

### Slide 14: Challenges & Solutions
- **Challenge**: Hackathon AWS role lacked SNS and IAM tagging permissions
  - **Solution**: Stripped SNS from template, used pre-existing WSParticipantRole for all Lambda functions
- **Challenge**: Backend returning anomalies with missing fields (severity, anomaly_type, ticker)
  - **Solution**: Added defensive null checks across all UI components
- **Challenge**: Real-time updates without polling
  - **Solution**: DynamoDB Streams → Lambda → WebSocket push architecture

### Slide 15: Impact & Future Work
**Current capabilities:**
- Detects 3 types of suspicious trading patterns
- AI-powered case narratives
- Real-time monitoring across all Kalshi markets
- Admin dashboard for usage analytics

**Future enhancements:**
- Machine learning models trained on historical insider trading cases
- Cross-market correlation analysis
- Integration with additional prediction market exchanges (Polymarket, PredictIt)
- Automated regulatory reporting
- Mobile app for compliance officers

### Slide 16: Closing
- Live demo: https://kalshiwatchdog.me
- GitHub: https://github.com/StuartCohen22/KalshiWatchdog
- Built with: 13 AWS services, Claude 3 Haiku, Kalshi API
- Thank you!

---

## Formatting Guidelines:
- Use clear, concise bullet points
- Include relevant statistics and numbers
- Add visual hierarchy with headers and subheaders
- Suggest where screenshots/diagrams would be most effective
- Keep technical jargon minimal on early slides, increase detail progressively
- Use action-oriented language ("Detects", "Flags", "Analyzes" vs "Can detect", "Is able to flag")
- Emphasize real-world impact and regulatory importance

## Tone:
- Professional but accessible
- Emphasize the problem's importance (market integrity, regulatory compliance)
- Highlight technical sophistication without being overwhelming
- Show enthusiasm for the solution

Generate the presentation in Markdown format with clear slide breaks and speaker notes where helpful.
