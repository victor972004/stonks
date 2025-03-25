require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const yahooFinance = require('yahoo-finance2').default;
const schedule = require('node-schedule');
const fs = require('fs');
const path = require('path');

// Suppress deprecation notice
yahooFinance.suppressNotices(['ripHistorical']);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Storage setup
const DATA_PATH = path.join(__dirname, 'market-data.json');
let marketData = {
  lastStatus: null,
  alertChannel: null
};

// Load existing data
if (fs.existsSync(DATA_PATH)) {
  marketData = JSON.parse(fs.readFileSync(DATA_PATH));
}

function saveMarketData() {
  fs.writeFileSync(DATA_PATH, JSON.stringify(marketData, null, 2));
}

// Schedule daily check (4:05 PM EST, Monday-Friday)
const rule = new schedule.RecurrenceRule();
rule.dayOfWeek = [new schedule.Range(1, 5)]; // Monday to Friday
rule.hour = 16 + 5; // 21 UTC (4 PM EST + 5 hours)
rule.minute = 5;

const job = schedule.scheduleJob(rule, async () => {
  if (!marketData.alertChannel) return;
  
  const channel = await client.channels.fetch(marketData.alertChannel);
  if (!channel) return;

  try {
    const data = await getAssetData('^GSPC'); // Monitor S&P 500
    if (!data) return;

    const currentStatus = data.currentPrice > data.ma200 ? 'above' : 'below';
    
    if (marketData.lastStatus && marketData.lastStatus !== currentStatus) {
      const direction = currentStatus === 'above' ? '🔺 BULLISH CROSSOVER 🔺' : '🔻 BEARISH CROSSOVER 🔻';
      const message = [
        `**MARKET ALERT** ${direction}`,
        `S&P 500 has closed ${currentStatus} its 200-Day MA!`,
        `**Close Price:** $${data.currentPrice.toFixed(2)}`,
        `**200-Day MA:** $${data.ma200.toFixed(2)}`,
        `**Crossover Type:** ${currentStatus === 'above' ? 'Golden Cross' : 'Death Cross'}`
      ].join('\n');

      channel.send(message);
    }

    marketData.lastStatus = currentStatus;
    saveMarketData();
  } catch (error) {
    console.error('Scheduled job error:', error);
  }
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

async function getAssetData(symbol) {
  try {
    // First validate symbol exists
    const quote = await yahooFinance.quote(symbol);
    if (!quote) return null;

    // Get proper display name
    const name = quote.longName || quote.shortName || symbol;

    // Get historical data
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - 1);

    const result = await yahooFinance.chart(symbol, {
      period1: startDate,
      period2: endDate,
      interval: '1d'
    });

    if (!result?.quotes || result.quotes.length < 200) return null;
    
    const quotes = result.quotes
      .filter(q => q.close)
      .map(q => q.close)
      .reverse();

    if (quotes.length < 200) return null;

    const currentPrice = quotes[0];
    const ma50 = quotes.slice(0, 50).reduce((a, b) => a + b, 0) / 50;
    const ma200 = quotes.slice(0, 200).reduce((a, b) => a + b, 0) / 200;
    
    // RSI calculations
    const rsi5 = quotes.length >= 6 ? calculateRSI(quotes.slice(0, 6), 5) : null;
    const rsi14 = quotes.length >= 15 ? calculateRSI(quotes.slice(0, 15), 14) : null;

    return {
      name,
      symbol,
      currentPrice,
      ma50,
      ma200,
      rsi5,
      rsi14
    };
  } catch (error) {
    console.error(`Data error for ${symbol}:`, error);
    return null;
  }
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log(`Next alert check: ${job.nextInvocation()}`);
});

client.on('messageCreate', async message => {
  if (message.content.toLowerCase().startsWith('!setalertchannel')) {
    if (!message.member.permissions.has('ADMINISTRATOR')) {
      return message.reply('❌ You need administrator permissions to set the alert channel.');
    }

    marketData.alertChannel = message.channel.id;
    saveMarketData();
    message.reply(`✅ Alerts will be sent to this channel (${message.channel.name})`);
  }
  if (message.content.toLowerCase().startsWith('!stonks')) {
    try {
      const args = message.content.split(' ');
      if (args[1]?.toLowerCase() === 'help') {
        const helpMessage = [
          "**📈 Stonks Bot Help**",
          "Check stock prices and technical indicators for US/HK markets",
          "",
          "**Usage:**",
          "`!stonks <symbol>` - Get market data for a symbol",
          "",
          "**Symbol Formats:**",
          "```",
          "US Stocks:    AAPL, TSLA, NVDA",
          "HK Stocks:    0700.HK, 9988.HK",
          "Indices:      ^GSPC (S&P 500), ^HSI (Hang Seng)",
          "```",
          "",
          "**Examples:**",
          "`!stonks AAPL`    - Apple Inc (US)",
          "`!stonks 0700.HK` - Tencent (Hong Kong)",
          "`!stonks ^HSI`    - Hang Seng Index",
          "",
          "Note: Symbols must follow Yahoo Finance format"
        ].join('\n');

        return message.reply(helpMessage);
      }

      // Existing command logic
      if (args.length < 2) {
        return message.reply('❌ Please specify a symbol. Use `!stonks help` for formats');
      }

      const symbol = args[1].toUpperCase();
      const data = await getAssetData(symbol);
      
      if (!data) {
        return message.reply(`📉 Invalid symbol or no data for ${symbol}\n` +
          'Use `!stonks help` for symbol format examples');
      }
      
      if (!data) {
        return message.reply(`📉 Invalid symbol or no data available for ${symbol}\n` +
          '**Examples:**\n' +
          'US Stocks: `!stonks AAPL`, `!stonks TSLA`\n' +
          'HK Stocks: `!stonks 0700.HK`, `!stonks 9988.HK`\n' +
          'Indices: `!stonks ^GSPC`, `!stonks ^HSI`');
      }

      const status50 = data.currentPrice > data.ma50 ? 'ABOVE' : 'BELOW';
      const status200 = data.currentPrice > data.ma200 ? 'ABOVE' : 'BELOW';
      
      const diff50 = Math.abs(data.currentPrice - data.ma50);
      const diff200 = Math.abs(data.currentPrice - data.ma200);
      
      const percentDiff50 = (diff50 / data.ma50 * 100).toFixed(2);
      const percentDiff200 = (diff200 / data.ma200 * 100).toFixed(2);

      const rsi5Status = data.rsi5 >= 70 ? '🚨 Overbought' : 
                        data.rsi5 <= 30 ? '🔔 Oversold' : '⚖️ Neutral';
      const rsi14Status = data.rsi14 >= 70 ? '🚨 Overbought' : 
                         data.rsi14 <= 30 ? '🔔 Oversold' : '⚖️ Neutral';

      const response = [
        `**${data.name} (${data.symbol})**`,
        `💵 Current Price: $${data.currentPrice.toFixed(2)}`,
        `📊 Moving Averages:`,
        `- 50-Day: $${data.ma50.toFixed(2)} (${status50} by ${percentDiff50}%)`,
        `- 200-Day: $${data.ma200.toFixed(2)} (${status200} by ${percentDiff200}%)`,
        '',
        `📈 Technical Indicators:`,
        `5-Day RSI: ${data.rsi5?.toFixed(1) || 'N/A'} ${rsi5Status}`,
        `14-Day RSI: ${data.rsi14?.toFixed(1) || 'N/A'} ${rsi14Status}`
      ].join('\n');

      message.reply(response);
    } catch (error) {
      console.error('Command error:', error);
      message.reply('💥 Error fetching data. Use `!stonks help` for format examples');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);