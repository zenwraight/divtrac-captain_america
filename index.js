const https = require('https');
const express = require("express");
const cors = require('cors');
const app = express()
const port = 3000

const yahooFinance = require("yahoo-finance2").default;

const { initializeApp } = require('firebase/app');

const { getFirestore, collection, getDocs, doc, getDoc } = require('firebase/firestore');

require("dotenv").config();

const redis = require("redis");

const date = require('date-and-time');

const readXlsxFile = require('read-excel-file/node')

let redisClient;

// Connect to Firebase
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDERID,
  appId: process.env.FIREBASE_APP_ID,
  measurementId: process.env.FIREBASE_MEASUREMENT_ID
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const firebaseAdmin = require("firebase-admin");

const serviceAccount = require("./serviceAccountKey.json");

firebaseAdmin.initializeApp({
  credential: firebaseAdmin.credential.cert(serviceAccount)
});

const connectToRedis = async() => {
  redisClient = redis.createClient({
    socket: {
        host: process.env.REDIS_HOSTNAME,
        port: process.env.REDIS_PORT
    },
    password: process.env.REDIS_PASSWORD
  });

  redisClient.on("connect", () => {
    console.log("Connected to our redis instance!");
    redisClient .set("Greatest Basketball Player", "Lebron James");

    // Initialize values
    redisClient.set("stock_list", JSON.stringify([]));
    redisClient.set("fetched_dates", JSON.stringify([]));
    redisClient.set("stocks_count", 0);
  });

  redisClient.on("error", function(error) {
      console.error(error);
  });

  await redisClient.connect();
}

app.use(
  cors({
    origin: [`http://localhost:${port}`, `https://localhost:${port}`],
    credentials: 'true',
  })
);

// This hashmap is to store which all stocks last price has been fetched
let fetchedLastStockPrice;

const fetchLastStockPriceQueue = async () => {

}

// This is to fetch current price of stock delayed by every 60 minutes
const getLastStockPrice = async (stockSymbol) => {
  console.log("Fetching last stock price for:- " + stockSymbol);

  try {
    const result = await yahooFinance.quoteSummary(stockSymbol, { modules: [ "price" ] });

    const stockPriceOverview = {
      price: result.price.regularMarketPrice,
      priceChange: result.price.regularMarketChange,
      priceChangePercent: result.price.regularMarketChangePercent
    }
    console.log(stockPriceOverview);
    await redisClient.set(stockSymbol+"_last_price", JSON.stringify(stockPriceOverview));
    fetchedLastStockPrice.add(stockSymbol);
  } catch (err) {
    fetchedLastStockPrice.add(stockSymbol);
    console.log(err);
  }
}

const getDividendMonthsFromLastYear = (dividends) => {
  const now = new Date();

  let currentYear = now.getFullYear();
  let prevYear = currentYear - 1;

  let monthArr = [];

  dividends.forEach(row => {
    let exDividendDate = date.preparse(row.exOrEffDate, 'MM/DD/YYYY');
    if (exDividendDate.Y == prevYear) {
      monthArr.push(exDividendDate.M);
    }
  });
  
  if (monthArr.length == 0) {
    // If this is the case, that means this stock recently decided to pay dividends
    // no-op for now
  }

  console.log(monthArr);
  return monthArr;
}

// This is to fetch all the dividend data for Stocks
const getDividendDataForStocks = async (stockSymbol) => {
  console.log("Start fetching Dividend Data for Stocks " + stockSymbol);
  const url = "https://api.nasdaq.com/api/quote/"+stockSymbol+"/dividends?assetclass=stocks";

  var requestOptions = {
    method: 'GET',
    redirect: 'follow',
    headers: {
        'authority': 'api.nasdaq.com',
        'accept': 'application/json, text/plain, */*',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36',
        'origin': 'https://www.nasdaq.com',
        'sec-fetch-site': 'same-site',
        'sec-fetch-mode': 'cors',
        'sec-fetch-dest': 'empty',
        'referer': 'https://www.nasdaq.com/',
        'accept-language': 'en-US,en;q=0.9',
    }
  };
  
  await fetch(url, requestOptions)
    .then(response => response.text())
    .then(result => {
      const resultJson = JSON.parse(result);
      if (resultJson.data != null) {
        const dividendHeaderValues = resultJson.data.dividendHeaderValues;
        // Call the parse header method
        const stockDividendOverview = {
          symbol: stockSymbol,
          dividendExDate: dividendHeaderValues[0].value,
          dividendYield: dividendHeaderValues[1].value,
          annualDividend: dividendHeaderValues[2].value,
          peRatio: dividendHeaderValues[3].value
        }
  
        redisClient.set(stockSymbol+"_dividend_overview", JSON.stringify(stockDividendOverview));
  
        // Call the dividend calendar parse method
        if (resultJson.data.dividends != null) {
          let dividendMonthArr = getDividendMonthsFromLastYear(resultJson.data.dividends.rows);
          redisClient.set(stockSymbol+"_dividend_month_forecast", JSON.stringify(dividendMonthArr));
          if (resultJson.data.dividends.rows.length > 10) {
            let slicedRows = resultJson.data.dividends.rows.slice(0,15);
            redisClient.set(stockSymbol+"_dividend_data", JSON.stringify(slicedRows));
          } else {
            redisClient.set(stockSymbol+"_dividend_data", JSON.stringify(resultJson.data.dividends.rows));
          }
        }
      }
    })
    .catch(err => {
      console.log(err);
    })
}

// This is to fetch Dividend data for all the ETFs
const getDividendDataForEtfs = async (etfSymbol) => {
  console.log("Start web scraping");
  const url = "https://api.nasdaq.com/api/quote/"+etfSymbol+"/dividends?assetclass=etf";

  var requestOptions = {
    method: 'GET',
    redirect: 'follow'
  };
  
  await fetch(url, requestOptions)
    .then(response => response.text())
    .then(result => {
      const resultJson = JSON.parse(result);
      if (resultJson.data != null) {
        const dividendHeaderValues = resultJson.data.dividendHeaderValues;
        // Call the parse header method
        const etfDividendOverview = {
          symbol: etfSymbol,
          dividendExDate: dividendHeaderValues[0].value,
          dividendYield: dividendHeaderValues[1].value,
          annualDividend: dividendHeaderValues[2].value,
          peRatio: dividendHeaderValues[3].value
        }
  
        redisClient.set(etfSymbol+"_dividend_overview", JSON.stringify(etfDividendOverview));
  
        // Call the dividend calendar parse method
        if (resultJson.data.dividends != null) {
          let dividendMonthArr = getDividendMonthsFromLastYear(resultJson.data.dividends.rows);
          redisClient.set(etfSymbol+"_dividend_month_forecast", JSON.stringify(dividendMonthArr));
          if (resultJson.data.dividends.rows.length > 10) {
            let slicedRows = resultJson.data.dividends.rows.slice(0,10);
            redisClient.set(etfSymbol+"_dividend_data", JSON.stringify(slicedRows));
          } else {
            redisClient.set(etfSymbol+"_dividend_data", JSON.stringify(resultJson.data.dividends.rows));
          }
        }
      }
    })
    .catch(err => {
      console.log(err);
    })
}

const saveDividendDataToFirestore = async() => {
  readXlsxFile('Stock.xlsx').then(async (rows) => {
    for(let i=1; i<rows.length-1; i++) {
      let symbol = rows[i][0];
      let dividendData = await redisClient.get(symbol+"_dividend_data");
      let dividendOverview = await redisClient.get(symbol+"_dividend_overview");
      let dividendMonthForecast = await redisClient.get(symbol+"_dividend_month_forecast");

      let dividendDataJson = JSON.parse(dividendData);
      let dividendOverviewJson = JSON.parse(dividendOverview);
      let dividendMonthForecastJson = JSON.parse(dividendMonthForecast);

      if (dividendOverviewJson != null) {
        const dividendDbData = {
          symbol: dividendOverviewJson.symbol,
          dividendExDate: dividendOverviewJson.dividendExDate,
          dividendYield: dividendOverviewJson.dividendYield,
          annualDividend: dividendOverviewJson.annualDividend,
          peRatio: dividendOverviewJson.peRatio,
          lastYearDividendMonths: dividendMonthForecastJson,
          dividendHistory: dividendDataJson
        };
  
        const db = firebaseAdmin.firestore();
  
        const stockDb = db.collection('stocks');
        const symbolDoc = stockDb.doc(symbol);
  
        await symbolDoc.set({dividendDbData});
      }
    }
  });

  readXlsxFile('ETF.xlsx').then(async (rows) => {
    for(let i=1; i<rows.length-1; i++) {
      let symbol = rows[i][0];
      let dividendData = await redisClient.get(symbol+"_dividend_data");
      let dividendOverview = await redisClient.get(symbol+"_dividend_overview");
      let dividendMonthForecast = await redisClient.get(symbol+"_dividend_month_forecast");

      let dividendDataJson = JSON.parse(dividendData);
      let dividendOverviewJson = JSON.parse(dividendOverview);
      let dividendMonthForecastJson = JSON.parse(dividendMonthForecast);

      if (dividendOverviewJson != null) {
        const dividendDbData = {
          symbol: dividendOverviewJson.symbol,
          dividendExDate: dividendOverviewJson.dividendExDate,
          dividendYield: dividendOverviewJson.dividendYield,
          annualDividend: dividendOverviewJson.annualDividend,
          peRatio: dividendOverviewJson.peRatio,
          lastYearDividendMonths: dividendMonthForecastJson,
          dividendHistory: dividendDataJson
        };
  
        const db = firebaseAdmin.firestore();
  
        const stockDb = db.collection('etfs');
        const symbolDoc = stockDb.doc(symbol);
  
        await symbolDoc.set({dividendDbData});
      }
    }
  });
}

const saveToFirestore = async() => {
  const firestore = firebaseAdmin.firestore();
  let batch = firestore.batch();
  let counter = 0;
  let totalCounter = 0;
  const promises = [];
  MANY_MANY_THINGS = [1,2,3,4,5,6,7,8,9,0]
  for (const thing of MANY_MANY_THINGS) {
    counter++;
    const docRef = firestore.collection("MY_COLLECTION").doc();
    batch.set(docRef, {
      foo: "1",
      bar: "2",
      favNumber: 0,
    });
    if (counter >= 500) {
      console.log(`Committing batch of ${counter}`);
      promises.push(batch.commit());
      totalCounter += counter;
      counter = 0;
      batch = firestore.batch();
    }
  }
  if (counter) {
    console.log(`Committing batch of ${counter}`);
    promises.push(batch.commit());
    totalCounter += counter;
  }
  await Promise.all(promises);
  console.log(`Committed total of ${totalCounter}`);
}

const fetchLastStockPriceDataFromApi = async () => {
  readXlsxFile('Stock.xlsx').then(async (rows) => {
    for(let i=1; i<rows.length-1; i++) {
      let symbol = rows[i][0];
      if (!fetchedLastStockPrice.has(symbol)) {
        await getLastStockPrice(symbol);
      }
    }
  });

  readXlsxFile('ETF.xlsx').then(async (rows) => {
    for(let i=1; i<rows.length-1; i++) {
      let symbol = rows[i][0];
      if (!fetchedLastStockPrice.has(symbol)) {
        await getLastStockPrice(symbol);
      }
    }
  });
}

const fetchLastStockPriceDataForIndividualStock = async (stockSymbol) => {
  console.log("STARTED stock price fetch");
  await getLastStockPrice(stockSymbol);
  // await getLastStockPriceUsingHttps(stockSymbol);
  console.log("COMPLETED Stock fetch");
}

const fetchDividendDataFromApiForStocks = async () => {
   
  // Stocks API - https://api.nasdaq.com/api/quote/AAPL/dividends?assetclass=stocks

  // ETF API - https://api.nasdaq.com/api/quote/VYM/dividends?assetclass=etf

  // ETF summary - https://api.nasdaq.com/api/quote/SPHD/summary?assetclass=etf

  // Stocks summary - https://api.nasdaq.com/api/quote/AAPL/summary?assetclass=stocks

  readXlsxFile('Stock.xlsx').then(async (rows) => {
    for(let i=1; i<rows.length-1; i++) {

      const companyOverview = {
        symbol: rows[i][0],
        name: rows[i][1],
        marketCap: rows[i][5],
        country: rows[i][6],
        ipoYear: rows[i][7],
        sector: rows[i][9],
        industry: rows[i][10]
      };
      let symbol = rows[i][0];
      redisClient.set(symbol+"_company_overview", JSON.stringify(companyOverview));

      await getDividendDataForStocks(symbol);
    }
  });
}

const fetchDividendDataFromApiForEtfs = async () => {
   
  // Stocks API - https://api.nasdaq.com/api/quote/AAPL/dividends?assetclass=stocks

  // ETF API - https://api.nasdaq.com/api/quote/VYM/dividends?assetclass=etf

  // ETF summary - https://api.nasdaq.com/api/quote/SPHD/summary?assetclass=etf

  // Stocks summary - https://api.nasdaq.com/api/quote/AAPL/summary?assetclass=stocks

  readXlsxFile('ETF.xlsx').then(async (rows) => {
    for(let i=1; i<rows.length-1; i++) {

      const companyOverview = {
        symbol: rows[i][0],
        name: rows[i][1]
      };
      let symbol = rows[i][0];
      redisClient.set(symbol+"_company_overview", JSON.stringify(companyOverview));

      await getDividendDataForEtfs(symbol);
    }
  });
}

const getStocks = async (db) => {
  const docRef = doc(db, "Stocks", "AAPL");
  const docSnap = await getDoc(docRef);

  console.log(docSnap.data());
}

// getStocks(db);

// connectToRedis();

// fetchLastStockPriceDataFromApi();

// Schedule tasks to be run on the server.

// This is the cron job to fetch Dividend data for all stocks and etfs
// Runs once a week
// cron.schedule('0 0 0 * * 0', function() {
//   console.log('running task every 00:00 on Sunday');
// });

// // This is the cron job to fetch last price of the stock
// // Runs every 30 minutes
// cron.schedule('0 */30 * * * *', function() {
//   console.log('running task every 45 minutes');
// });

connectToRedis();

const testMethod = () => {
  console.log("Hello World! called");
  console.log("Set is:- " + fetchedLastStockPrice);
}

app.get('/', (req, res) => {
  console.log("Print Hello World!");
  const now = new Date().toISOString();
  redisClient.set("now_date", now);
  res.send('Hello World!')
})

// This api we will currently hit manually every week once
app.get('/getDividendData', (req, res) => {
  console.log("STARTING to fetch latest dividend data for stocks and etfs");
  fetchDividendDataFromApiForStocks();
  fetchDividendDataFromApiForEtfs();
  console.log("Dividend data for stocks and etfs COMPLETE");
  res.send('Dividend Data fetching complete');
});


app.get('/getLatestStockPrice', async (req, res) => {
  console.log("STARTING to fetch latest stock prices");
  fetchedLastStockPrice = new Set();
  await fetchLastStockPriceDataFromApi();
  console.log("Latest Stock price fetching COMPLETE");
  res.send('Successfully fetched latest Stock price');
});

app.get('/test', async (req, res) => {
  await getDividendDataForStocks("AAPL");
  res.send("DONE fetching latest individual stock price");
});

// app.get('/test/scrape', async (req, res) => {
//   await getLastStockPriceWebScraped("AAPL");
//   res.send("Done scraping the stock price");
// })

// This API we will hit every week once using cron job org
app.get('/saveDataToFirestore', async (req, res) => {
  console.log("STARTED storing data into Firestore");
  await saveDividendDataToFirestore();
  console.log("COMPLETED storing data into Firestore");
  res.send("Data saved to Firestore");
});

const server = app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})

process.on('SIGTERM', () => {
  server.close(() => {
    console.log('SIGNAL TERMINATED RECEIVED');
    testMethod();
  })
})

// Export the Express API
module.exports = app;
// export default app;