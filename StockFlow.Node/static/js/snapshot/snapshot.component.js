﻿'use strict';

// Register `snapshot` component, along with its associated controller and template
angular.
    module('snapshot').
    component('snapshot', {
        templateUrl: '/static/html/snapshot.template.html',
        controller: ['$scope', '$routeParams', 'SnapshotService', 'NewSnapshotService', 'SnapshotDecisionService',
            function SnapshotController($scope, $routeParams, SnapshotService, NewSnapshotService, SnapshotDecisionService) {
                var self = this;

                self.loading = true;

                var currentLocation = window.location.href;

                var service = undefined;
                var params = undefined;
                if ($routeParams.id == "new") {
                    service = NewSnapshotService;
                    params = { instrumentId: $routeParams.instrumentId };
                } else {
                    service = SnapshotService;
                    params = { id: $routeParams.id };
                }

                self.snapshot = service.get(params, function (snapshot) {
                    if (currentLocation == window.location.href) {
                        history.replaceState(null, '', '#!/snapshot/' + snapshot.ID);

                        self.setRates(snapshot);

                        self.loading = false;
                    }
                }, function (error) {
                    if (currentLocation == window.location.href) {
                        self.loading = false;

                        window.location.href = '#!/snapshots';

                        if (typeof (error.data) !== 'undefined' && error.data != null) {
                            console.error('error: ' + JSON.stringify(error.data));
                        }
                    }
                });

                self.setRates = function setRates(snapshot) {

                    if (snapshot.PreviousTime == null) {
                        $scope.series = [snapshot.Name];
                        $scope.datasetOverride = [
                            {
                                yAxisID: 'y-axis-2'
                            }
                        ];
                    }
                    else {
                        $scope.series = [snapshot.Name, "loss", "gain", "loss/gain", "buy"];
                        $scope.datasetOverride = [
                            {
                                yAxisID: 'y-axis-2'
                            },
                            {
                                yAxisID: 'y-axis-2',
                                backgroundColor: 'rgba(255,0,0,0.2)',
                                borderColor: 'red',
                                fill: '+3'
                            },
                            {
                                yAxisID: 'y-axis-2',
                                backgroundColor: 'rgba(0,255,0,0.2)',
                                borderColor: 'green',
                                fill: '+2'
                            },
                            {
                                yAxisID: 'y-axis-2',
                                backgroundColor: 'rgba(255,128,0,0.2)',
                                borderColor: 'orange',
                                fill: '+1'
                            },
                            {
                                yAxisID: 'y-axis-2',
                                backgroundColor: 'rgba(151,187,205,0.2)',
                                borderColor: 'transparent'
                            }
                        ];

                    }

                    $scope.options = {
                        scales: {
                            yAxes: [
                                {
                                    id: 'y-axis-2',
                                    type: 'linear',
                                    display: true,
                                    position: 'right'
                                }
                            ],
                            xAxes: [{
                                ticks: {
                                    autoSkip: true,
                                    maxTicksLimit: 5,
                                    maxRotation: 0 // angle in degrees
                                }
                            }]
                        },
                        elements: {
                            point: {
                                radius: 0
                            }
                        },
                        animation: false
                    };

                    function yymmdd(date) {
                        var y = date.getYear();
                        var m = date.getMonth() + 1;
                        var d = date.getDate();
                        var mm = m < 10 ? '0' + m : m;
                        var dd = d < 10 ? '0' + d : d;
                        return '' + (y % 100) + mm + dd;
                    }

                    function parseDate(dateString) {
                        return new Date(
                            (+("20" + dateString.substr(6, 2))),
                            (+dateString.substr(3, 2)) - 1,
                            (+dateString.substr(0, 2)),
                            0,
                            0,
                            0
                        );
                    }

                    function GetData(rates) {

                        if (snapshot.PreviousTime == null) {
                            return [
                                rates.map(function (v, i) {
                                    return v.C;
                                })
                            ];
                        } else {
                            var previousSnapshotIndex = rates.length - 1;
                            for (var i = 0; i < rates.length; i++) {
                                if (rates[i].T >= snapshot.PreviousTime) {
                                    previousSnapshotIndex = i;
                                    break;
                                }
                            }

                            return [
                                rates.map(function (v, i) {
                                    if (i <= previousSnapshotIndex)
                                        return v.C;
                                    return null;
                                }),
                                rates.map(function (v, i) {
                                    if (i >= previousSnapshotIndex && v.C <= snapshot.PreviousBuyRate)
                                        return v.C;
                                    return null;
                                }),
                                rates.map(function (v, i) {
                                    if (i >= previousSnapshotIndex && v.C >= snapshot.PreviousBuyRate)
                                        return v.C;
                                    return null;
                                }),
                                rates.map(function (v, i) {
                                    if (i >= previousSnapshotIndex) {
                                        if (i < rates.length - 1 && i > 0) {
                                            var previousRate = rates[i - 1];
                                            var nextRate = rates[i + 1];
                                            var sgn1 = Math.sign(previousRate.C - snapshot.PreviousBuyRate);
                                            var sgn2 = Math.sign(v.C - snapshot.PreviousBuyRate);
                                            var sgn3 = Math.sign(nextRate.C - snapshot.PreviousBuyRate);
                                            if (sgn1 != sgn2 || sgn2 != sgn3)
                                                return v.C;
                                        }
                                    }
                                    return null;
                                }),
                                rates.map(function (v, i) {
                                    if (i >= previousSnapshotIndex)
                                        return snapshot.PreviousBuyRate;
                                    return null;
                                })
                            ];
                        }
                    }

                    function getSplitFactor(previousRate, rate) {
                        var factor = previousRate / rate;
                        var round = Math.round(factor);
                        if (round >= 2 && round < 100) {
                            var frac = factor - round;
                            if (Math.abs(frac) < 0.01 * round) {
                                return round;
                            }
                        }

                        factor = rate / previousRate;
                        round = Math.round(factor);
                        if (round >= 2 && round < 100) {
                            var frac = factor - round;
                            if (Math.abs(frac) < 0.01 * round) {
                                return 1 / round;
                            }
                        }

                        return 1;
                    }

                    var previousRate = snapshot.Rates[0].C;
                    var splitFactor = 1;
                    for (var i = 0; i < snapshot.Rates.length; ++i) {
                        var currentRate = snapshot.Rates[i].C;
                        splitFactor *= getSplitFactor(previousRate, currentRate);
                        snapshot.Rates[i].C = splitFactor * currentRate;
                        previousRate = currentRate;
                    }

                    $scope.labels5 = snapshot.Rates.map(function (v) {
                        return v.T.substr(4, 2) + "." + v.T.substr(2, 2) + "." + v.T.substr(0, 2);
                    });

                    $scope.data5 = GetData(snapshot.Rates);

                    var endDate = parseDate(snapshot.Date);
                    var startDate = yymmdd(new Date(endDate.setMonth(endDate.getMonth() - 12)));

                    var startDateIndex = snapshot.Rates.length - 1;
                    for (; startDateIndex >= 0; --startDateIndex) {
                        var rateDate = snapshot.Rates[startDateIndex].T;
                        if (rateDate == startDate) {
                            break;
                        }
                        if (rateDate < startDate) {
                            startDateIndex++;
                            break;
                        }
                    }

                    $scope.labels1 = $scope.labels5.slice(startDateIndex);

                    if (snapshot.PreviousTime == null) {
                        $scope.data1 = [
                            $scope.data5[0].slice(startDateIndex)
                        ];
                    } else {
                        $scope.data1 = [
                            $scope.data5[0].slice(startDateIndex),
                            $scope.data5[1].slice(startDateIndex),
                            $scope.data5[2].slice(startDateIndex),
                            $scope.data5[3].slice(startDateIndex),
                            $scope.data5[4].slice(startDateIndex),
                        ];
                    }
                };

                self.setDecision = function setDecision(decision) {
                    self.loading = true;
                    SnapshotDecisionService.get({ id: self.snapshot.ID, decision: decision }, function () {
                        self.loading = false;
                        window.location.href = '#!/snapshot/new/random';
                    });
                };
            }
        ]
    });