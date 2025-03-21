require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const yahooFinance = require('yahoo-finance2').default;

// Suppress deprecation notice
yahooFinance.suppressNotices(['ripHistorical']);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

function calculateRSI(closes, period) {
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const difference = closes[i-1] - closes[i];
    if (difference > 0) gains += difference;
    else losses += Math.abs(difference);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;
  const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

async function getMarketData() {
    try {
      // Get dates for 1 year range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setFullYear(endDate.getFullYear() - 1);
  
      const result = await yahooFinance.chart('^GSPC', {
        period1: startDate,
        period2: endDate,
        interval: '1d' // Daily interval
      });
  
      if (!result?.quotes || result.quotes.length < 200) return null;
      
      const quotes = result.quotes
        .filter(q => q.close) // Filter out null/missing data
        .map(q => q.close)
        .reverse(); // Reverse to get latest first
  
      if (quotes.length < 200) return null;
  
      const currentPrice = quotes[0];
      const ma200 = quotes.slice(0, 200).reduce((a, b) => a + b, 0) / 200;
      
      // RSI calculations (needs at least period+1 days of data)
      const rsi5 = quotes.length >= 6 ? calculateRSI(quotes.slice(0, 6), 5) : null;
      const rsi14 = quotes.length >= 15 ? calculateRSI(quotes.slice(0, 15), 14) : null;
  
      return {
        currentPrice,
        ma200,
        rsi5,
        rsi14
      };
    } catch (error) {
      console.error('Market data error:', error);
      return null;
    }
}

// Rest of the code remains the same as previous version
client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async message => {
  if (message.content.toLowerCase() === '!stonks') {
    try {
      const data = await getMarketData();
      
      if (!data) {
        return message.reply('Could not fetch market data 📉');
      }

      const status = data.currentPrice > data.ma200 ? 'ABOVE 📈' : 'BELOW 📉';
      const difference = Math.abs(data.currentPrice - data.ma200);
      const percentDiff = (difference / data.ma200 * 100).toFixed(2);

      const rsi5Status = data.rsi5 >= 70 ? '🚨 Overbought' : data.rsi5 <= 30 ? '🔔 Oversold' : '⚖️ Neutral';
      const rsi14Status = data.rsi14 >= 70 ? '🚨 Overbought' : data.rsi14 <= 30 ? '🔔 Oversold' : '⚖️ Neutral';

      const response = [
        `**S&P 500 Current Price:** $${data.currentPrice.toFixed(2)}`,
        `**200-Day MA:** $${data.ma200.toFixed(2)} (${status} by $${difference.toFixed(2)} [${percentDiff}%])`,
        '',
        '**RSI Indicators:**',
        `5-Day: ${data.rsi5?.toFixed(1) || 'N/A'} ${rsi5Status}`,
        `14-Day: ${data.rsi14?.toFixed(1) || 'N/A'} ${rsi14Status}`
      ].join('\n');

      message.reply(response);
    } catch (error) {
      console.error('Command error:', error);
      message.reply('Error fetching stonks data 💥');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);