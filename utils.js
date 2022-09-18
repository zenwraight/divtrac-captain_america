const admin = require('firebase-admin');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const serviceAccount = require('./serviceAccountKey.json');

require('better-logging')(console);

const date = require('date-and-time');

//initialize admin SDK using serciceAcountKey
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Checks if the document with a particular name exists in the Stocks collection or not
const documentExists = async(docId) => {
  const usersRef = db.collection('Stocks').doc(docId)

  return await usersRef.get()
    .then((docSnapshot) => {
      if (docSnapshot.exists) {
        return true;
      } else {
        return false;
      }
  });
}

// Checks if the key exists in the redis or not
const stockKeyExists = async(stockSymbol, redisClient) => {
  return await redisClient.get(stockSymbol, function(err, data){
    // data is null if the key doesn't exist
    if(err || data === null) {
      return false;
    } else {
      return true;
    }
  });
}

// To print extra lines to make debug logs readable 
const consoleLogExtraLines = () => {
  for(let i=0; i<5; i++) {
    console.log("*****");
  }
}

// Set last date of fetched stock for hunter
module.exports.setLastDateForFetchedStock = (date, redisClient) => {
  // return await db.collection('Timestamp').doc("Hunter_Fetched_Stock_Date")
  // .set({date: date}).then(async() => {
  //   console.log("Data saved in Firestore");
  //   // Save new data with key inside the redis
    
  // });
  redisClient.set("Hunter_Fetched_Stock_Date", JSON.stringify({date: date}));
}

// Fetch last fetched date for hunter
module.exports.getLastDateForFetchedStock = async (redisClient) => {
  const lastFetchedDate = await redisClient.get("Hunter_Fetched_Stock_Date");
  if (lastFetchedDate) {
    //console.log("Date fetched from Redis cache");
    //console.log(lastFetchedDate);
    return JSON.parse(lastFetchedDate).date;
  } else {
    //console.log("Inside getLastDateForFetchedStock else block");
    const now = new Date();
    // current year
    let year = now.getFullYear();
    const startDate = date.parse((year-3)+'-01-01', 'YYYY-MM-DD');
    redisClient.set("Hunter_Fetched_Stock_Date", JSON.stringify({date: date.format(startDate, 'YYYY-MM-DD')}));
    const newFetchedDate = await redisClient.get("Hunter_Fetched_Stock_Date");
    return JSON.parse(newFetchedDate).date;
  }
}

// Fetch Data of a stock from Redis cache
module.exports.getStockInfoFromRedis = async (stockSymbol, redisClient) => {
  return await redisClient.get(stockSymbol);
}

// Get all the Stock list stored in Redis
module.exports.getStockListFromRedis = async (redisClient) => {
  return await redisClient.get("stock_list");
}

// Add Stock list as set to redis
const addStocksToRedisSet = async (stockSymbol, redisClient) => {
  let fetchedStocksList = await redisClient.get("stock_list");
  fetchedStocksList = JSON.parse(fetchedStocksList);
  //console.log("Fetched Stocks:- " + fetchedStocksList);
  let fetchedStocksSet = new Set(fetchedStocksList);
  //console.log("Fetched Stocks Old Set:- " + JSON.stringify(fetchedStocksSet));
  fetchedStocksSet.add(stockSymbol);
  //console.log("Fetched Stocks New Set:- " + JSON.stringify(fetchedStocksSet));
  redisClient.set("stock_list", JSON.stringify(Array.from(fetchedStocksSet)));

  redisClient.set("stocks_count", fetchedStocksSet.size);
}

// Add a particular stock to Redis
module.exports.addStockToRedis = async (stock, redisClient) => {

  await addStocksToRedisSet(stock.symbol, redisClient);

  const redisStockData = {
      symbol: stock.symbol, 
      companyName: stock.companyName, 
      dividendExDate: stock.dividendExDate, 
      paymentDate: stock.paymentDate, 
      recordDate: stock.recordDate, 
      dividendRate: stock.dividendRate, 
      annualDividend: stock.annualDividend,
      announcementDate: stock.announcementDate,
  };  

  const redisStockKeyExists = await stockKeyExists(stock.symbol, redisClient);

  if(redisStockKeyExists) {
    const stockInfo = await redisClient.get(stock.symbol);
    //.log("Stock Data fetched from Reids:- "+stockInfo);
    //consoleLogExtraLines();
    stockInfoJson = JSON.parse(stockInfo);
    stockInfoJson.info.push(redisStockData);
    redisClient.set(stock.symbol, JSON.stringify(stockInfoJson));
    //console.log("Updated existing stock information in Redis");
    //consoleLogExtraLines();
  } else {
    const stockInfo = {info: [redisStockData]};
      
    // Save new data with key inside the redis
    redisClient.set(stock.symbol, JSON.stringify(stockInfo));
    //console.log("New Stock information written to Redis");
    //consoleLogExtraLines();
  }
}

// Add a particular stock to the Firestore
module.exports.addStockToDb = async (stock, redisClient) => {
  //console.log("Stock is:- " + stock);
  let cnt = redisClient.get("stocks_count");
  redisClient.set("stocks_count", parseInt(cnt)+1);
  //console.log("Stock count is:- " + cnt);
  const firestoreStockData = {
      symbol: stock.symbol, 
      companyName: stock.companyName, 
      dividendExDate: stock.dividendExDate, 
      paymentDate: stock.paymentDate, 
      recordDate: stock.recordDate, 
      dividendRate: stock.dividendRate, 
      annualDividend: stock.annualDividend,
      announcementDate: stock.announcementDate,
  };
  //const docExists = await documentExists(stock.symbol);
  const redisStockKeyExists = await stockKeyExists(stock.symbol, redisClient);
  if(redisStockKeyExists) {
    //console.log("Document exists with name:- "+stock.symbol);
    //consoleLogExtraLines();
    const stocksDocRef = db.collection('Stocks').doc(stock.symbol);
    // Atomically add a new stock dividend data to the info array field.
    let arrUnion = stocksDocRef.update({
      info: FieldValue.arrayUnion(firestoreStockData)
    }).then(async() => {
      const stockInfo = await redisClient.get(stock.symbol);
      //console.log("Stock Data fetched from Reids:- "+stockInfo);
      //consoleLogExtraLines();
      stockInfoJson = JSON.parse(stockInfo);
      stockInfoJson.info.push(firestoreStockData);
      redisClient.set(stock.symbol, JSON.stringify(stockInfoJson));
      //console.log("Updated existing stock information");
      //consoleLogExtraLines();
    });
  } else {
    //console.log("Document doesn't exists with name:- "+stock.symbol);
    //consoleLogExtraLines();
    return await db.collection('Stocks').doc(stock.symbol)
    .set({info: [firestoreStockData]}).then(async() => {
      const stockInfo = {info: [firestoreStockData]};
      
      // Save new data with key inside the redis
      redisClient.set(stock.symbol, JSON.stringify(stockInfo));
      
      // for testing purpose
      // const savedData = await redisClient.get(stock.symbol);
      // console.log(JSON.parse(savedData));
      // consoleLogExtraLines();

      //console.log("New Stock information written to db");
      //consoleLogExtraLines();
    });
  }
}
