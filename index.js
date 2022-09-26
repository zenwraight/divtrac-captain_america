const https = require('https');
// import express from 'express';
const express = require("express");
const cors = require('cors');
const app = express()
const port = 3000

// import {
//   initializeApp
// } from 'firebase/app';

const { initializeApp } = require('firebase/app');

// import {
//   getFirestore,
//   doc,
//   getDoc
// } from 'firebase/firestore';
const { getFirestore, collection, getDocs, doc, getDoc } = require('firebase/firestore');

// import * as dotenv from 'dotenv';
// dotenv.config()

require("dotenv").config();

// import redis from "redis";
const redis = require("redis");

// import readXlsxFile from 'read-excel-file';
const readXlsxFile = require('read-excel-file/node')

// const { 
//   addStockToDb, 
//   getLastDateForFetchedStock,  
//   setLastDateForFetchedStock,
//   getStockInfoFromRedis,
//   addStockToRedis,
//   getStockListFromRedis
// } = require('./utils');

// import date from 'date-and-time';

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

app.use(
  cors({
    origin: [`http://localhost:${port}`, `https://localhost:${port}`],
    credentials: 'true',
  })
);

const getLastStockPriceUsingHttps = async (stockSymbol) => {
  console.log("Fetch stock price for " + stockSymbol);

  const url = "https://api.nasdaq.com/api/quote/AAPL/info?assetclass=stocks";
    
  const axios = require('axios');

  // axios.default.withCredentials = true

  // var config = {
  //   method: 'get',
  //   withCredentials: true,
  //   url: 'https://api.nasdaq.com/api/quote/AAPL/info?assetclass=stocks',
  //   headers: {
  //     'Access-Control-Allow-Origin': '*', 
  //     'Content-Type': 'application/json'
  //   }
  // };
  
  // await axios(config)
  // .then(function (response) {
  //   console.log(JSON.stringify(response.data));
  // })
  // .catch(function (error) {
  //   console.log(error);
  // });
  await axios.get(url, { 
    withCredentials: true,
    headers: {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
  })
    .then(function (response) {
    console.log(JSON.stringify(response.data));
  })
  .catch(function (error) {
    console.log(error);
  });
}


// This is to fetch current price of stock delayed by every 30 minutes
const getLastStockPrice = async (stockSymbol) => {
  console.log("Fetch stock price for " + stockSymbol);

  const url = "https://api.nasdaq.com/api/quote/"+stockSymbol+"/info?assetclass=stocks";

  var requestOptions = {
    method: 'GET',
    redirect: 'follow'
  };

  await fetch(url)
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

app.get('/', (req, res) => {
  console.log("Print Hello World!");
  const now = new Date().toISOString();
  redisClient.set("now_date", now);
  res.send('Hello World!')
})

app.get('/getDividendData', (req, res) => {
  console.log("STARTING to fetch latest dividend data for stocks and etfs");
  fetchDividendDataFromApiForStocks();
  fetchDividendDataFromApiForEtfs();
  console.log("Dividend data for stocks and etfs COMPLETE");
  res.send('Dividend Data fetching complete');
});

app.get('/getLatestStockPrice', (req, res) => {
  console.log("STARTING to fetch latest stock prices");
  fetchLastStockPriceDataFromApi();
  console.log("Latest Stock price fetching COMPLETE");
  res.send('Successfully fetched latest Stock price');
});

app.get('/test', (req, res) => {

  // const cookieHeader = req.headers;
  // console.log(cookieHeader);
  fetchLastStockPriceDataForIndividualStock("AAPL");
  res.send("DONE fetching latest individual stock price");
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})


// Export the Express API
module.exports = app;
// export default app;