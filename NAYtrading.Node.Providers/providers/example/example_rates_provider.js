var exports = module.exports = {}

var config = require('../../config/envconfig');
var downloader = require('../downloader');

exports.source = "e";
exports.markets = config.example_markets;
exports.market_not_found = "market not found";
exports.invalid_response = "invalid response";

exports.getRates = async function (source, instrumentId, marketId, startTime, endTime) {
    if (source != exports.source)
        throw "invalid source";

    var response = {
        "markets": {
            "1": {
                "marketId": "1",
                "isin": "example",
                "wkn": "example"
            }
        },
        "rates": [
            {
                "Time": startTime,
                "Low": 1,
                "Open": 2,
                "Close": 3,
                "High": 4
            },
            {
                "Time": endTime,
                "Low": 5,
                "Open": 6,
                "Close": 7,
                "High": 8
            }
        ]
    };

    if (response && response.markets) {
        if (response.markets[marketId] && response.markets[marketId].marketId == marketId) {

            var isin = response.markets[marketId].isin;
            var wkn = response.markets[marketId].wkn;

            function toSnapshotRate(data) {

                // TODO map json to naytrading format
                var result = {
                    Open: data.Open,
                    Close: data.Close,
                    High: data.High,
                    Low: data.Low,
                    Time: data.Time
                }

                return result;
            }

            var rates = response.rates
                .map(x => toSnapshotRate(x))
                .filter(x => x.Time >= startTime)
                .filter(x => typeof (x.Close) !== 'undefined' && x.Close != null);

            rates.sort(function (a, b) { return a.Time.getTime() - b.Time.getTime() });

            var distinctDays = [];
            var lastDate = undefined;
            for (var i = 0; i < rates.length; ++i) {
                var rate = rates[i];
                var date = new Date(rate.Time.getYear(), rate.Time.getMonth(), rate.Time.getDate());
                if (i == 0) {
                    distinctDays.push(rate);
                    lastDate = date;
                } else {
                    if (date > lastDate) {
                        distinctDays.push(rate);
                        lastDate = date;
                    } else {
                        distinctDays[distinctDays.length - 1] = rate;
                    }
                }
            }

            return {
                Isin: isin,
                Wkn: wkn,
                Rates: distinctDays
            };
        }
        else if (Object.keys(response.markets)) {
            return {
                Isin: null,
                Wkn: null,
                Rates: null,
                MarketIds: Object.keys(response.markets)
            };
        }
        else {
            throw exports.invalid_response + ": " + JSON.stringify(response);
        }
    }
    else {
        throw exports.invalid_response;
    }
};