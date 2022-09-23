const cron = require('node-cron');

const express = require('express')
const app = express()
const port = 3000

const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, getDoc } = require('firebase/firestore');

const {
  Stock
} = require("./models/stock");

require("dotenv").config();
const redis = require("redis");

const readXlsxFile = require('read-excel-file/node')

// const { 
//   addStockToDb, 
//   getLastDateForFetchedStock,  
//   setLastDateForFetchedStock,
//   getStockInfoFromRedis,
//   addStockToRedis,
//   getStockListFromRedis
// } = require('./utils');

require('better-logging')(console);

const date = require('date-and-time');

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

const getDividendData = async (date, redisClient) => {
  //console.log("Inside method " + date);
  var config = {
    method: 'get',
    url: 'https://api.nasdaq.com/api/calendar/dividends?date='+date,
  };
  
  var requestOptions = {
    method: 'GET',
    redirect: 'follow'
  };
  
  await fetch("https://api.nasdaq.com/api/calendar/dividends?date="+date, requestOptions)
    .then(response => response.text())
    .then(result => {
      //console.log(result.data);
      responseJson = JSON.parse(result);
      //console.log(responseJson.data);
      if(responseJson.data === undefined || 
        responseJson.data === null
      ) {
        //console.log("Data is null");
        return;
      } else if (
        responseJson.data.calendar === undefined ||
        responseJson.data.calendar === null
      ) {
        //console.log("Calendar is null");
        return;
      } else if(
        responseJson.data.calendar.rows === undefined ||
        responseJson.data.calendar.rows === null
      )  {
        //console.log("Data rows are null");
        return;
      } else {
        //console.log("Looping over rows");
        //console.log("Redis client is:- ", redisClient);
        responseJson.data.calendar.rows.forEach(async (stockRow) => {
          //console.log("Inside Dividend stock rows");
          const stock = new Stock(
            stockRow.symbol,
            stockRow.symbol,
            stockRow.companyName,
            stockRow.dividend_Ex_Date,
            stockRow.payment_Date,
            stockRow.record_Date,
            stockRow.dividend_Rate,
            stockRow.indicated_Annual_Dividend,
            stockRow.announcement_Date
          );
          //console.log("Redis client is:- ", redisClient);
          await addStockToRedis(stock, redisClient);
        });
      }
    })
    .catch(function (error) {
      console.error(error);
      //console.log("Let's Retry again after sometime");
      setTimeout(async function () {
        //console.log("Retry getting Dividend data");
        await getDividendData(date, redisClient).then(function () {
          //console.log("Retry method complete");
        });
      }, 1000);
    });

  // await axios(config)
  // .then(function (response) {
  //   console.log("Completed fetching data");
  //   responseJson = JSON.parse(JSON.stringify(response.data));
  //   if(responseJson.data === undefined || 
  //     responseJson.data === null
  //   ) {
  //     return;
  //   } else if (
  //     responseJson.data.calendar === undefined ||
  //     responseJson.data.calendar === null
  //   ) {
  //     return;
  //   } else if(
  //     responseJson.data.calendar.rows === undefined ||
  //     responseJson.data.calendar.rows === null
  //   )  {
  //     return;
  //   } else {
  //     responseJson.data.calendar.rows.forEach(async (stockRow) => {
  //       const stock = new Stock(
  //         stockRow.symbol,
  //         stockRow.symbol,
  //         stockRow.companyName,
  //         stockRow.dividend_Ex_Date,
  //         stockRow.payment_Date,
  //         stockRow.record_Date,
  //         stockRow.dividend_Rate,
  //         stockRow.indicated_Annual_Dividend,
  //         stockRow.announcement_Date
  //       );
  //       await addStockToDb(stock);
  //     });
  //   }
  // })
  // .catch(function (error) {
  //   console.error(error);
  //   console.log("Let's Retry again after sometime");
  //   setTimeout(async function () {
  //     console.log("Retry getting Dividend data");
  //     await getDividendData(date, redisClient).then(function () {
  //       console.log("Retry method complete");
  //     });
  //   }, 1000);
  // });
}

const addFetchedDatesToSet = async (newDate, redisClient) => {
  let fetchedDates = await redisClient.get("fetched_dates");
  fetchedDates = JSON.parse(fetchedDates);
  //console.log("Fetched Dates:- " + fetchedDates);
  let fetchedDatesSet = new Set(fetchedDates);
  //console.log("Fetched Dates Old Set:- " + JSON.stringify(fetchedDatesSet));
  fetchedDatesSet.add(newDate);
  //console.log("Fetched Dates New Set:- " + JSON.stringify(fetchedDatesSet));
  redisClient.set("fetched_dates", JSON.stringify(Array.from(fetchedDatesSet)));
}

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


// This is to fetch current price of stock delayed by every 30 minutes
const getLastStockPrice = async (stockSymbol) => {
  console.log("Fetch stock price for " + stockSymbol);

  const url = "https://api.nasdaq.com/api/quote/"+stockSymbol+"/info?assetclass=stocks";

  var requestOptions = {
    method: 'GET',
    redirect: 'follow'
  };

  await fetch(url, requestOptions)
    .then(response => response.text())
    .then(result => {
      const resultJson = JSON.parse(result);
      if (resultJson.data != null) {
        const stockLastPriceInfo = {
          symbol: stockSymbol,
          lastSalePrice: resultJson.data.primaryData.lastSalePrice,
          netChange: resultJson.data.primaryData.netChange,
          percentageChange: resultJson.data.primaryData.percentageChange,
          deltaIndicator: resultJson.data.primaryData.deltaIndicator,
        };

        redisClient.set(stockSymbol+"_info", JSON.stringify(stockLastPriceInfo));
      }
    })
    .catch(err => {
      console.log(err);
    })
}

// This is to fetch all the dividend data for Stocks
const getDividendDataForStocks = async (stockSymbol) => {
  console.log("Start fetching Dividend Data for Stocks " + stockSymbol);
  const url = "https://api.nasdaq.com/api/quote/"+stockSymbol+"/dividends?assetclass=stocks";

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
        const stockDividendOverview = {
          symbol: stockSymbol,
          dividendExDate: dividendHeaderValues[0].value,
          dividendYield: dividendHeaderValues[1].value,
          annualDividend: dividendHeaderValues[2].value,
          peRatio: dividendHeaderValues[3].value
        }
  
        redisClient.set(stockSymbol+"_dividend_overview", JSON.stringify(stockDividendOverview));
        console.log(stockDividendOverview);
  
        // Call the dividend calendar parse method
        if (resultJson.data.dividends != null) {
          if (resultJson.data.dividends.rows.length > 10) {
            let slicedRows = resultJson.data.dividends.rows.slice(0,10);
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
        const stockDividendOverview = {
          symbol: etfSymbol,
          dividendExDate: dividendHeaderValues[0].value,
          dividendYield: dividendHeaderValues[1].value,
          annualDividend: dividendHeaderValues[2].value,
          peRatio: dividendHeaderValues[3].value
        }
  
        redisClient.set(etfSymbol+"_dividend_overview", JSON.stringify(stockDividendOverview));
        console.log(stockDividendOverview);
  
        // Call the dividend calendar parse method
        if (resultJson.data.dividends != null) {
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

const fetchLastStockPriceDataFromApi = async () => {
  readXlsxFile('Stock.xlsx').then(async (rows) => {
    for(let i=1; i<rows.length-1; i++) {
      let symbol = rows[i][0];
      await getLastStockPrice(symbol);
    }
  });

  readXlsxFile('ETF.xlsx').then(async (rows) => {
    for(let i=1; i<rows.length-1; i++) {
      let symbol = rows[i][0];
      await getLastStockPrice(symbol);
    }
  });
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

const main = async () => {  
  let lastFetchedDate = await getLastDateForFetchedStock(redisClient);
  
  if (lastFetchedDate) {
    const now = new Date();
    //console.log(date.format(now, 'YYYY-MM-DD'));
    
    // current year
    let year = now.getFullYear();
    let newDate = date.parse((year-2)+'-01-01', 'YYYY-MM-DD');
    
    // We will start our iteration from last Fetched Date to current date 
    while(date.format(now, 'YYYY-MM-DD') != date.format(newDate, 'YYYY-MM-DD')) {
      await getDividendData(date.format(newDate, 'YYYY-MM-DD'), redisClient);
      await addFetchedDatesToSet(newDate, redisClient);
      newDate = date.addDays(newDate, 1);
    }

    // Now we will start our iteration from current date till next 365 days in total
    for(var i=0; i<=150; i++) {
      await getDividendData(date.format(newDate, 'YYYY-MM-DD'), redisClient);
      await addFetchedDatesToSet(newDate, redisClient);
      newDate = date.addDays(newDate, 1);
    }
    await setLastDateForFetchedStock(date.format(newDate, 'YYYY-MM-DD'), redisClient);
  } else {
    const now = new Date();
    //console.log(date.format(now, 'YYYY-MM-DD'));
    
    // current year
    let year = now.getFullYear();
    const startDate = date.parse((year-3)+'-01-01', 'YYYY-MM-DD');
    
    //console.log(date.format(startDate, 'YYYY-MM-DD'));
    
    let newDate = startDate;
    
    // We will start our iteration from Jan 1st of 3 years back to current date 
    while(date.format(now, 'YYYY-MM-DD') != date.format(newDate, 'YYYY-MM-DD')) {
      await getDividendData(date.format(newDate, 'YYYY-MM-DD'), redisClient);
      await addFetchedDatesToSet(newDate, redisClient);
      newDate = date.addDays(newDate, 1);
    }
    
    newDate = now;
    // Now we will start our iteration from current date till next 365 days in total
    for(var i=0; i<=150; i++) {
      await getDividendData(date.format(newDate, 'YYYY-MM-DD'), redisClient);
      await addFetchedDatesToSet(newDate, redisClient);
      newDate = date.addDays(newDate, 1);
    }
    await setLastDateForFetchedStock(date.format(newDate, 'YYYY-MM-DD'), redisClient);
  }
  
  //console.log(await getStockListFromRedis(redisClient));
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

app.get('/', (req, res) => {
  console.log()
  res.send('Hello World!')
})

app.listen(port, () => {
  connectToRedis();
  cron.schedule('* * * * * *', function() {
    const now = new Date().toISOString();
    redisClient.set("now_date", now);
    console.log("Task is running every second");
  })
  console.log(`Example app listening on port ${port}`)
})

// cron.schedule('* * * * * *', function() {

//   console.log("Task is running every second");
// })