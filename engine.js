/* HeapMatch engine: pure in-place heap sort order matching.
 * No node objects, no pointers, no Array.prototype.sort.
 * Optional `hook(event, arr)` receives compare/swap/extract events for the debugger.
 */
(function (root) {
  'use strict';

  class HeapSortExchangeEngine {
    constructor(ticker) {
      this.ticker = ticker;
      this.bids = [];
      this.asks = [];
      this.trades = [];
    }

    submitOrder(order) {
      if (order.quantity <= 0) return;
      (order.side === 'BUY' ? this.bids : this.asks).push(order);
    }

    /** True if A outranks B (strict price-time priority). */
    hasHigherPriority(a, b) {
      if (a.price !== b.price) {
        return a.side === 'BUY' ? a.price > b.price : a.price < b.price;
      }
      return a.timestamp < b.timestamp;
    }

    /** Restores the heap downward; lowest-priority element sits at the root. */
    siftDown(arr, root, heapSize, m, hook, phase) {
      let current = root;
      while (true) {
        const left = 2 * current + 1;
        const right = 2 * current + 2;
        let lowest = current;

        if (left < heapSize) {
          m.comparisons++;
          if (hook) hook({ t: 'compare', i: lowest, j: left, size: heapSize, phase }, arr);
          if (this.hasHigherPriority(arr[lowest], arr[left])) lowest = left;
        }
        if (right < heapSize) {
          m.comparisons++;
          if (hook) hook({ t: 'compare', i: lowest, j: right, size: heapSize, phase }, arr);
          if (this.hasHigherPriority(arr[lowest], arr[right])) lowest = right;
        }
        if (lowest === current) break;

        const tmp = arr[current];
        arr[current] = arr[lowest];
        arr[lowest] = tmp;
        m.swaps++;
        if (hook) hook({ t: 'swap', i: current, j: lowest, size: heapSize, phase }, arr);
        current = lowest;
      }
    }

    /** In-place heap sort. Index 0 ends as the highest-priority order. */
    heapSortOrders(arr, hook) {
      const m = { comparisons: 0, swaps: 0, auxiliaryMemoryBytes: 0 };
      const n = arr.length;
      if (n <= 1) return m;

      for (let i = Math.floor(n / 2) - 1; i >= 0; i--) {
        this.siftDown(arr, i, n, m, hook, 'build');
      }
      if (hook) hook({ t: 'built', size: n }, arr);

      for (let end = n - 1; end > 0; end--) {
        const tmp = arr[0];
        arr[0] = arr[end];
        arr[end] = tmp;
        m.swaps++;
        if (hook) hook({ t: 'extract', i: 0, j: end, size: end, phase: 'extract' }, arr);
        this.siftDown(arr, 0, end, m, hook, 'extract');
      }
      if (hook) hook({ t: 'done', size: n }, arr);
      return m;
    }

    /** Sorts both books, then clears crossing orders with a two-pointer sweep. */
    clearBatchAuction(hooks) {
      hooks = hooks || {};
      const bidMetrics = this.heapSortOrders(this.bids, hooks.bid);
      const askMetrics = this.heapSortOrders(this.asks, hooks.ask);

      const batchTrades = [];
      let b = 0;
      let a = 0;

      while (b < this.bids.length && a < this.asks.length) {
        const bestBid = this.bids[b];
        const bestAsk = this.asks[a];
        if (bestBid.price < bestAsk.price) break;

        const qty = Math.min(bestBid.quantity, bestAsk.quantity);
        const price = bestBid.timestamp < bestAsk.timestamp ? bestBid.price : bestAsk.price;

        const ex = {
          buyOrderId: bestBid.orderId,
          sellOrderId: bestAsk.orderId,
          ticker: bestBid.ticker,
          executionPrice: price,
          quantity: qty,
          executedAt: Date.now(),
        };
        batchTrades.push(ex);
        this.trades.push(ex);

        bestBid.quantity -= qty;
        bestAsk.quantity -= qty;
        if (bestBid.quantity === 0) b++;
        if (bestAsk.quantity === 0) a++;
      }

      this.compactInPlace(this.bids, b);
      this.compactInPlace(this.asks, a);
      return { trades: batchTrades, bidMetrics, askMetrics };
    }

    compactInPlace(arr, startIdx) {
      if (startIdx === 0) return;
      let w = 0;
      for (let r = startIdx; r < arr.length; r++) arr[w++] = arr[r];
      arr.length = w;
    }
  }

  const parent = (i) => Math.floor((i - 1) / 2);
  const leftChild = (i) => 2 * i + 1;
  const rightChild = (i) => 2 * i + 2;

  root.HeapMatch = { HeapSortExchangeEngine, parent, leftChild, rightChild };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.HeapMatch;
})(typeof window !== 'undefined' ? window : globalThis);
