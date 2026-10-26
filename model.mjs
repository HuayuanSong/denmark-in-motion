export function flowValue(row, sex) { return sex === 1 ? row[3] : sex === 2 ? row[4] : row[3] + row[4]; }
export function matrixFor(rows, count, age = 0, sex = 0) {
  const matrix = Array.from({length: count}, () => new Float64Array(count));
  for (const row of rows) if (!age || row[2] === age - 1) matrix[row[0]][row[1]] += flowValue(row, sex);
  return matrix;
}
export function statsFor(matrix, area) {
  const outgoing = matrix[area].reduce((a,b) => a+b,0);
  const incoming = matrix.reduce((a,row) => a+row[area],0);
  return {incoming, outgoing, net: incoming-outgoing};
}
export function netRate(incoming, outgoing, population) { return population > 0 ? (incoming-outgoing)/population*1000 : null; }
export function partnersFor(matrix, area, direction) {
  return matrix.map((row,i) => ({i, count: direction === 'out' ? matrix[area][i] : row[area]}))
    .filter(row=>row.i !== area && row.count > 0).sort((a,b)=>b.count-a.count || a.i-b.i);
}
export function routeSeries(rows, destination, years, age, sex) {
  const totals = Object.fromEntries(years.map(year => [year,0]));
  for (const [year,to,band,men,women] of rows) if(to===destination && (!age || band===age-1))
    totals[year] += sex===1 ? men : sex===2 ? women : men+women;
  return years.map(year=>totals[year]);
}
