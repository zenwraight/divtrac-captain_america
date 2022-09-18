class Stock {
  constructor(
    id, 
    symbol, 
    companyName, 
    dividendExDate, 
    paymentDate, 
    recordDate, 
    dividendRate, 
    annualDividend,
    announcementDate
  ) {
    this.id = id; // in our case id will be equal to symbol
    this.symbol = symbol;
    this.companyName = companyName;
    this.dividendExDate = dividendExDate;
    this.paymentDate = paymentDate;
    this.recordDate = recordDate;
    this.dividendRate = dividendRate;
    this.annualDividend = annualDividend;
    this.announcementDate = announcementDate;
  }
}

class StockDividendOverview {
  constructor(
    symbol,
    dividendExDate,
    dividendYield,
    annualDividend,
    peRatio
  ) {
    this.symbol = symbol;
    this.dividendExDate = dividendExDate;
    this.dividendYield = dividendYield;
    this.annualDividend = annualDividend;
    this.peRatio = peRatio;
  }
}

module.exports = {
  Stock,
  StockDividendOverview
};
