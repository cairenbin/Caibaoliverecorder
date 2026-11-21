// Preserve the filter clock's rounded, half-open intervals. FFmpeg represents
// a flat sum as a left-deep tree, so a long list can fail at parse time.
export function overlayTimeExpression(intervals, precision) {
  if (intervals.length === 0) return '0';
  const ranges = [];
  const rounded = intervals.map(([start,end])=>[Number(start.toFixed(precision)),Number(end.toFixed(precision))]);
  for (const [start,end] of rounded.sort((a,b)=>a[0]-b[0])) {
    if (end <= start) continue;
    const previous = ranges.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1],end);
    else ranges.push([start,end]);
  }
  if (ranges.length === 0) return '0';
  function build(first,last) {
    if (last-first === 1) {
      const [start,end] = ranges[first];
      return `gte(t,${start.toFixed(precision)})*lt(t,${end.toFixed(precision)})`;
    }
    const middle = first+Math.floor((last-first)/2);
    return `if(lt(t,${ranges[middle][0].toFixed(precision)}),${build(first,middle)},${build(middle,last)})`;
  }
  return build(0,ranges.length);
}
