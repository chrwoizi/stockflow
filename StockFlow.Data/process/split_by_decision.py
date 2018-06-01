import os
import sys
import argparse
import datetime
from decimal import Decimal
from itertools import groupby

sys.path.append(os.path.abspath('..\\..\\StockFlow.Common'))
from Progress import *
from KillFileMonitor import *


parser = argparse.ArgumentParser()

parser.add_argument('--input_path', type=str, default='data\\flat.csv', help='Input file path.')
parser.add_argument('--output_path_buy', type=str, default='data\\buy.csv', help='Output file path for buy decisions.')
parser.add_argument('--output_path_no_buy', type=str, default='data\\no_buy.csv', help='Output file path for no-buy decisions.')
parser.add_argument('--output_path_sell', type=str, default='data\\sell.csv', help='Output file path for sell decisions.')
parser.add_argument('--output_path_no_sell', type=str, default='data\\no_sell.csv', help='Output file path for no-sell decisions.')


def distinct(sequence, get_key):
    seen = set()
    for s in sequence:
        key = get_key(s)
        if not key in seen:
            seen.add(key)
            yield s

def get_metadata(input_path, report_progress):
    metas = []

    with open(input_path, 'r') as in_file:
        line_index = 0
        while True:
            report_progress()
            try:
                line = in_file.readline()
                if len(line) > 0:

                    if line_index > 0:

                        split = str(line).split(";")
                        id = split[0]
                        instrument_id = split[1]
                        decision = split[2]
                        time = datetime.datetime.strptime(split[3], '%Y%m%d').date()
                        last_rate = Decimal(split[len(split)-1])

                        meta = dict(
                            Line = line_index,
                            ID = id,
                            InstrumentId = instrument_id,
                            Decision = decision,
                            Time = time,
                            CurrentPrice = last_rate
                        )

                        metas += [meta]

                    line_index += 1
                else:
                    break
            except EOFError:
                break

    for group in groupby(metas, lambda x: x['InstrumentId']):
        report_progress()
        invested = False
        previous_buy_rate = Decimal(0)
        (k, v) = group
        for meta in sorted(v, key=lambda x: x['Time']):
            meta['Invested'] = invested
            meta['PreviousBuyRate'] = previous_buy_rate
            if meta['Decision'] == 'buy':
                invested = True
                previous_buy_rate = meta['CurrentPrice']
            if meta['Decision'] == 'sell':
                invested = False
                previous_buy_rate = Decimal(0)

    return metas

def main(input_path, output_path_buy, output_path_no_buy, output_path_sell, output_path_no_sell):
    output_dir = '.'

    if output_path_buy and len(output_path_buy) > 0:
        output_dir = os.path.dirname(os.path.abspath(output_path_buy))
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

    if output_path_no_buy and len(output_path_no_buy) > 0:
        output_dir = os.path.dirname(os.path.abspath(output_path_no_buy))
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

    if output_path_sell and len(output_path_sell) > 0:
        output_dir = os.path.dirname(os.path.abspath(output_path_sell))
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

    if output_path_no_sell and len(output_path_no_sell) > 0:
        output_dir = os.path.dirname(os.path.abspath(output_path_no_sell))
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)

    kill_path = output_dir + '\\kill'
    killfile_monitor = KillFileMonitor(kill_path, 1)

    output_path_buy_temp = (output_path_buy + '.incomplete') if output_path_buy and len(output_path_buy) > 0 else None
    output_path_no_buy_temp = (output_path_no_buy + '.incomplete') if output_path_no_buy and len(output_path_no_buy) > 0 else None
    output_path_sell_temp = (output_path_sell + '.incomplete') if output_path_sell and len(output_path_sell) > 0 else None
    output_path_no_sell_temp = (output_path_no_sell + '.incomplete') if output_path_no_sell and len(output_path_no_sell) > 0 else None

    try:
        metas = get_metadata(input_path, lambda: killfile_monitor.maybe_check_killfile())

        with open(input_path, 'r') as in_file:
            with open(output_path_buy_temp, 'w') if output_path_buy_temp else None as out_file_buy:
                with open(output_path_no_buy_temp, 'w') if output_path_no_buy_temp else None as out_file_no_buy:
                    with open(output_path_sell_temp, 'w') if output_path_sell_temp else None as out_file_sell:
                        with open(output_path_no_sell_temp, 'w') if output_path_no_sell_temp else None as out_file_no_sell:

                            header = "index;" + in_file.readline()

                            if out_file_buy:
                                out_file_buy.writelines([header])

                            if out_file_no_buy:
                                out_file_no_buy.writelines([header])

                            if out_file_sell:
                                out_file_sell.writelines([header])

                            if out_file_no_sell:
                                out_file_no_sell.writelines([header])

                            progress = Progress('split decision: ', 1)
                            progress.set_count(len(metas))

                            lines_read = 1
                            for meta in sorted(metas, key=lambda x: x['Line']):
                                killfile_monitor.maybe_check_killfile()
                                while meta['Line'] > lines_read:
                                    in_file.readline()
                                    lines_read += 1

                                line = in_file.readline()
                                lines_read += 1

                                if len(line) > 0:
                                    if meta['Invested']:

                                        if meta['Decision'] == 'sell':

                                            if out_file_sell:
                                                out_file_sell.writelines([str(lines_read) + ';' + line])

                                        elif meta['Decision'] == 'ignore':

                                            if out_file_buy:

                                                if meta['PreviousBuyRate'] > 0 and meta['PreviousBuyRate'] < meta['CurrentPrice'] * Decimal(1.01):
                                                    first_semicolon = line.index(';')
                                                    line_as_buy = line[0 : first_semicolon + 1] + 'buy' + line[line.index(';', first_semicolon + 1):]
                                                    out_file_buy.writelines([str(lines_read) + ';' + line_as_buy])

                                            if out_file_no_sell:
                                                out_file_no_sell.writelines([str(lines_read) + ';' + line])
                                    else:

                                        if meta['Decision'] == 'buy':

                                            if out_file_buy:
                                                out_file_buy.writelines([str(lines_read) + ';' + line])
                                        elif meta['Decision'] == 'ignore':

                                            if out_file_no_buy:
                                                out_file_no_buy.writelines([str(lines_read) + ';' + line])

                                progress.add_item()
                                progress.maybe_print()

        if output_path_buy is not None:
            if os.path.exists(output_path_buy):
                os.remove(output_path_buy)
            os.rename(output_path_buy_temp, output_path_buy)

        if output_path_no_buy is not None:
            if os.path.exists(output_path_no_buy):
                os.remove(output_path_no_buy)
            os.rename(output_path_no_buy_temp, output_path_no_buy)

        if output_path_sell is not None:
            if os.path.exists(output_path_sell):
                os.remove(output_path_sell)
            os.rename(output_path_sell_temp, output_path_sell)

        if output_path_no_sell is not None:
            if os.path.exists(output_path_no_sell):
                os.remove(output_path_no_sell)
            os.rename(output_path_no_sell_temp, output_path_no_sell)

    except KilledException:
        killfile_monitor.delete_killfile()

        if output_path_buy_temp is not None and os.path.exists(output_path_buy_temp):
            os.remove(output_path_buy_temp)

        if output_path_no_buy_temp is not None and os.path.exists(output_path_no_buy_temp):
            os.remove(output_path_no_buy_temp)

        if output_path_sell_temp is not None and os.path.exists(output_path_sell_temp):
            os.remove(output_path_sell_temp)

        if output_path_no_sell_temp is not None and os.path.exists(output_path_no_sell_temp):
            os.remove(output_path_no_sell_temp)

        print('Killed.')


if __name__ == '__main__':
    FLAGS, unparsed = parser.parse_known_args()

    main(input_path=FLAGS.input_path,
         output_path_buy=FLAGS.output_path_buy,
         output_path_no_buy=FLAGS.output_path_no_buy,
         output_path_sell=FLAGS.output_path_sell,
         output_path_no_sell=FLAGS.output_path_no_sell)