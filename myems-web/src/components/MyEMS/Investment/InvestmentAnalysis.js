import React, { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Col,
  Form,
  FormGroup,
  Input,
  Label,
  ListGroup,
  ListGroupItem,
  Row,
  Table
} from 'reactstrap';
import FalconCardHeader from '../../common/FalconCardHeader';
import withRedirect from '../../../hoc/withRedirect';
import { getCookieValue, createCookie, checkEmpty } from '../../../helpers/utils';
import { settings } from '../../../config';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const defaultAssumptions = {
  projectCapacityMW: 50,
  capexPerKw: 5200,
  opexPerKwYear: 120,
  capacityFactorPercent: 19,
  degradationPercent: 0.5,
  electricityPricePerKWh: 0.45,
  subsidyPerKWh: 0.05,
  priceEscalationPercent: 2,
  opexEscalationPercent: 1.5,
  discountRatePercent: 8,
  projectLifeYears: 25,
  currency: 'CNY'
};

const toNumber = value => {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const computeIRR = cashFlows => {
  if (!Array.isArray(cashFlows) || cashFlows.length < 2) {
    return null;
  }

  const npv = rate => {
    if (rate <= -1) {
      return Number.POSITIVE_INFINITY;
    }
    return cashFlows.reduce((accumulator, cashFlow, index) => {
      return accumulator + cashFlow / Math.pow(1 + rate, index);
    }, 0);
  };

  let low = -0.99;
  let high = 1.0;
  let npvLow = npv(low);
  let npvHigh = npv(high);

  if (!Number.isFinite(npvLow) || !Number.isFinite(npvHigh)) {
    return null;
  }

  let iteration = 0;
  while (npvLow * npvHigh > 0 && iteration < 100) {
    high += 1;
    npvHigh = npv(high);
    iteration += 1;
    if (!Number.isFinite(npvHigh)) {
      return null;
    }
  }

  if (npvLow * npvHigh > 0) {
    return null;
  }

  for (let index = 0; index < 100; index += 1) {
    const mid = (low + high) / 2;
    const npvMid = npv(mid);
    if (!Number.isFinite(npvMid)) {
      return null;
    }
    if (Math.abs(npvMid) < 1e-6) {
      return mid;
    }
    if (npvLow * npvMid < 0) {
      high = mid;
      npvHigh = npvMid;
    } else {
      low = mid;
      npvLow = npvMid;
    }
  }

  return (low + high) / 2;
};

const buildAnalysis = assumptions => {
  const capacityMW = toNumber(assumptions.projectCapacityMW);
  const capexPerKw = toNumber(assumptions.capexPerKw);
  const opexPerKwYear = toNumber(assumptions.opexPerKwYear);
  const capacityFactor = toNumber(assumptions.capacityFactorPercent) / 100;
  const degradationRate = toNumber(assumptions.degradationPercent) / 100;
  const electricityPricePerKWh = toNumber(assumptions.electricityPricePerKWh);
  const subsidyPerKWh = toNumber(assumptions.subsidyPerKWh);
  const priceEscalation = toNumber(assumptions.priceEscalationPercent) / 100;
  const opexEscalation = toNumber(assumptions.opexEscalationPercent) / 100;
  const discountRate = toNumber(assumptions.discountRatePercent) / 100;
  const projectLifeYears = Math.max(1, Math.round(toNumber(assumptions.projectLifeYears)));

  const installedKw = capacityMW * 1000;
  const initialCapex = installedKw * capexPerKw;
  const baseGenerationMWh = capacityMW * 8760 * capacityFactor;

  let cumulative = -initialCapex;
  let payback = null;
  let totalRevenue = 0;
  let totalOpex = 0;
  let discountedNPV = -initialCapex;
  let discountedOpex = 0;
  let discountedGenerationMWh = 0;
  let firstYearRevenue = 0;

  const cashflowRows = [
    {
      year: 0,
      generation: 0,
      revenue: 0,
      opex: 0,
      netCash: -initialCapex,
      discounted: -initialCapex,
      cumulative: cumulative
    }
  ];
  const cashflows = [];
  const labels = ['Year 0'];
  const netSeries = [-initialCapex];
  const cumulativeSeries = [cumulative];

  for (let year = 1; year <= projectLifeYears; year += 1) {
    const degradation = Math.pow(1 - degradationRate, year - 1);
    const generationMWh = baseGenerationMWh * degradation;
    const escalatedTariff =
      electricityPricePerKWh * Math.pow(1 + priceEscalation, year - 1) + subsidyPerKWh;
    const revenue = generationMWh * 1000 * escalatedTariff;
    const opex = installedKw * opexPerKwYear * Math.pow(1 + opexEscalation, year - 1);
    const netCash = revenue - opex;
    const discounted = netCash / Math.pow(1 + discountRate, year);

    if (year === 1) {
      firstYearRevenue = revenue;
    }

    cumulative += netCash;
    totalRevenue += revenue;
    totalOpex += opex;
    discountedNPV += discounted;
    discountedOpex += opex / Math.pow(1 + discountRate, year);
    discountedGenerationMWh += generationMWh / Math.pow(1 + discountRate, year);

    if (payback === null && cumulative >= 0) {
      const previousCumulative = cumulative - netCash;
      const fraction = netCash === 0 ? 1 : (0 - previousCumulative) / netCash;
      payback = year - 1 + Math.max(0, Math.min(1, fraction));
    }

    cashflows.push(netCash);
    labels.push(`Year ${year}`);
    netSeries.push(netCash);
    cumulativeSeries.push(cumulative);

    cashflowRows.push({
      year,
      generation: generationMWh,
      revenue,
      opex,
      netCash,
      discounted,
      cumulative
    });
  }

  const irr = computeIRR([-initialCapex, ...cashflows]);
  const lcoePerKWh =
    discountedGenerationMWh > 0
      ? (initialCapex + discountedOpex) / (discountedGenerationMWh * 1000)
      : null;
  const averageAnnualCash =
    cashflows.length > 0 ? cashflows.reduce((sum, value) => sum + value, 0) / cashflows.length : 0;

  return {
    summary: {
      initialCapex,
      npv: discountedNPV,
      irr,
      payback,
      lcoe: lcoePerKWh,
      averageAnnualCash,
      totalRevenue,
      totalOpex,
      finalCumulative: cumulative,
      annualGenerationMWh: baseGenerationMWh,
      deliveredTariff: electricityPricePerKWh + subsidyPerKWh,
      discountRate,
      firstYearRevenue
    },
    table: cashflowRows,
    chart: {
      labels,
      netSeries,
      cumulativeSeries
    }
  };
};

const InvestmentAnalysis = ({ setRedirect, setRedirectUrl }) => {
  const [assumptions, setAssumptions] = useState({ ...defaultAssumptions });

  useEffect(() => {
    const isLoggedIn = getCookieValue('is_logged_in');
    const userUuid = getCookieValue('user_uuid');
    const token = getCookieValue('token');
    const userName = getCookieValue('user_name');
    const displayName = getCookieValue('user_display_name');

    if (checkEmpty(isLoggedIn) || checkEmpty(token) || checkEmpty(userUuid) || !isLoggedIn) {
      setRedirectUrl(`/authentication/basic/login`);
      setRedirect(true);
    } else {
      createCookie('is_logged_in', true, settings.cookieExpireTime);
      createCookie('user_name', userName, settings.cookieExpireTime);
      createCookie('user_display_name', displayName, settings.cookieExpireTime);
      createCookie('user_uuid', userUuid, settings.cookieExpireTime);
      createCookie('token', token, settings.cookieExpireTime);
    }
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const isLoggedIn = getCookieValue('is_logged_in');
      if (isLoggedIn === null || !isLoggedIn) {
        setRedirectUrl(`/authentication/basic/login`);
        setRedirect(true);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [setRedirect, setRedirectUrl]);

  const analysis = useMemo(() => buildAnalysis(assumptions), [assumptions]);

  const handleAssumptionChange = event => {
    const { name, value } = event.target;
    setAssumptions(previous => ({
      ...previous,
      [name]: value
    }));
  };

  const resetAssumptions = () => {
    setAssumptions({ ...defaultAssumptions });
  };

  const formatCurrency = (value, digits = 0) => {
    if (!Number.isFinite(value)) {
      return '—';
    }
    return `${assumptions.currency} ${value.toLocaleString(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits
    })}`;
  };

  const formatNumber = (value, digits = 0) => {
    if (!Number.isFinite(value)) {
      return '—';
    }
    return value.toLocaleString(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits
    });
  };

  const formatPercent = (value, digits = 1) => {
    if (!Number.isFinite(value)) {
      return '—';
    }
    return `${(value * 100).toFixed(digits)}%`;
  };

  const paybackLabel = useMemo(() => {
    if (analysis.summary.payback === null) {
      return `>${assumptions.projectLifeYears} years`;
    }
    return `${analysis.summary.payback.toFixed(1)} years`;
  }, [analysis.summary.payback, assumptions.projectLifeYears]);

  const lineChartData = useMemo(
    () => ({
      labels: analysis.chart.labels,
      datasets: [
        {
          label: 'Net Cash Flow',
          data: analysis.chart.netSeries,
          borderColor: '#2c7be5',
          backgroundColor: 'rgba(44, 123, 229, 0.2)',
          tension: 0.3,
          fill: true,
          yAxisID: 'y'
        },
        {
          label: 'Cumulative Cash Flow',
          data: analysis.chart.cumulativeSeries,
          borderColor: '#00a78f',
          backgroundColor: 'rgba(0, 167, 143, 0.08)',
          tension: 0.2,
          fill: false,
          yAxisID: 'y1'
        }
      ]
    }),
    [analysis.chart]
  );

  const lineChartOptions = useMemo(
    () => ({
      responsive: true,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'bottom'
        },
        tooltip: {
          callbacks: {
            label: context => {
              const label = context.dataset.label || '';
              const value = context.parsed.y;
              return `${label}: ${formatCurrency(value, 0)}`;
            }
          }
        }
      },
      scales: {
        y: {
          title: {
            display: true,
            text: 'Net Cash Flow'
          },
          ticks: {
            callback: value => formatCurrency(value, 0)
          }
        },
        y1: {
          position: 'right',
          grid: {
            drawOnChartArea: false
          },
          title: {
            display: true,
            text: 'Cumulative Cash Flow'
          },
          ticks: {
            callback: value => formatCurrency(value, 0)
          }
        }
      }
    }),
    [formatCurrency]
  );

  const insights = useMemo(() => {
    const items = [];
    const delta = analysis.summary.irr !== null ? analysis.summary.irr * 100 - toNumber(assumptions.discountRatePercent) : null;
    if (analysis.summary.irr === null) {
      items.push('IRR could not be solved because cash flow does not turn positive within the analysis window.');
    } else if (delta >= 0) {
      items.push(`IRR exceeds the discount rate by ${delta.toFixed(1)} percentage points.`);
    } else {
      items.push(`IRR is ${Math.abs(delta).toFixed(1)} percentage points below the discount rate; review CAPEX or tariff assumptions.`);
    }

    if (analysis.summary.payback === null) {
      items.push(`The project does not pay back within ${assumptions.projectLifeYears} years.`);
    } else {
      items.push(`Simple payback occurs after approximately ${analysis.summary.payback.toFixed(1)} years.`);
    }

    if (Number.isFinite(analysis.summary.lcoe)) {
      const priceBuffer =
        (analysis.summary.deliveredTariff - analysis.summary.lcoe) / (analysis.summary.deliveredTariff || 1);
      items.push(
        `Levelized cost of ${formatCurrency(analysis.summary.lcoe, 3)}/kWh compares with a first-year tariff of ${formatCurrency(
          analysis.summary.deliveredTariff,
          3
        )}/kWh.`
      );
      if (Number.isFinite(priceBuffer)) {
        items.push(`Tariff headroom vs. LCOE is ${(priceBuffer * 100).toFixed(1)}%, indicating pricing resilience.`);
      }
    }

    items.push(
      `Lifetime net cash accumulation reaches ${formatCurrency(analysis.summary.finalCumulative)} after ${assumptions.projectLifeYears} years.`
    );

    return items;
  }, [analysis.summary, assumptions]);

  const highlights = useMemo(
    () => [
      {
        label: 'Net Present Value',
        value: formatCurrency(analysis.summary.npv)
      },
      {
        label: 'Internal Rate of Return',
        value: formatPercent(analysis.summary.irr)
      },
      {
        label: 'Payback Period',
        value: paybackLabel
      },
      {
        label: 'Levelized Cost of Energy',
        value: `${formatCurrency(analysis.summary.lcoe, 3)}/kWh`
      },
      {
        label: 'First-Year Generation',
        value: `${formatNumber(analysis.summary.annualGenerationMWh, 0)} MWh`
      },
      {
        label: 'Average Annual Cash Flow',
        value: formatCurrency(analysis.summary.averageAnnualCash)
      },
      {
        label: 'Total Revenue',
        value: formatCurrency(analysis.summary.totalRevenue)
      },
      {
        label: 'Total Operating Cost',
        value: formatCurrency(analysis.summary.totalOpex)
      }
    ],
    [analysis.summary, formatCurrency, formatNumber, formatPercent, paybackLabel]
  );

  return (
    <Row>
      <Col lg={4} className="mb-3">
        <Card className="mb-3 h-100">
          <FalconCardHeader title="Investment Assumptions" />
          <CardBody>
            <Form>
              <FormGroup>
                <Label for="projectCapacityMW">Project Capacity (MW)</Label>
                <Input
                  id="projectCapacityMW"
                  name="projectCapacityMW"
                  type="number"
                  step="0.1"
                  value={assumptions.projectCapacityMW}
                  onChange={handleAssumptionChange}
                />
              </FormGroup>
              <FormGroup>
                <Label for="capexPerKw">CAPEX per kW</Label>
                <Input
                  id="capexPerKw"
                  name="capexPerKw"
                  type="number"
                  step="10"
                  value={assumptions.capexPerKw}
                  onChange={handleAssumptionChange}
                />
              </FormGroup>
              <FormGroup>
                <Label for="opexPerKwYear">OPEX per kW per year</Label>
                <Input
                  id="opexPerKwYear"
                  name="opexPerKwYear"
                  type="number"
                  step="1"
                  value={assumptions.opexPerKwYear}
                  onChange={handleAssumptionChange}
                />
              </FormGroup>
              <FormGroup>
                <Label for="capacityFactorPercent">Capacity Factor (%)</Label>
                <Input
                  id="capacityFactorPercent"
                  name="capacityFactorPercent"
                  type="number"
                  step="0.1"
                  value={assumptions.capacityFactorPercent}
                  onChange={handleAssumptionChange}
                />
              </FormGroup>
              <FormGroup>
                <Label for="degradationPercent">Degradation (%/year)</Label>
                <Input
                  id="degradationPercent"
                  name="degradationPercent"
                  type="number"
                  step="0.1"
                  value={assumptions.degradationPercent}
                  onChange={handleAssumptionChange}
                />
              </FormGroup>
              <FormGroup>
                <Label for="electricityPricePerKWh">Electricity Price (per kWh)</Label>
                <Input
                  id="electricityPricePerKWh"
                  name="electricityPricePerKWh"
                  type="number"
                  step="0.01"
                  value={assumptions.electricityPricePerKWh}
                  onChange={handleAssumptionChange}
                />
              </FormGroup>
              <FormGroup>
                <Label for="subsidyPerKWh">Subsidy (per kWh)</Label>
                <Input
                  id="subsidyPerKWh"
                  name="subsidyPerKWh"
                  type="number"
                  step="0.01"
                  value={assumptions.subsidyPerKWh}
                  onChange={handleAssumptionChange}
                />
              </FormGroup>
              <FormGroup>
                <Label for="priceEscalationPercent">Tariff Escalation (%/year)</Label>
                <Input
                  id="priceEscalationPercent"
                  name="priceEscalationPercent"
                  type="number"
                  step="0.1"
                  value={assumptions.priceEscalationPercent}
                  onChange={handleAssumptionChange}
                />
              </FormGroup>
              <FormGroup>
                <Label for="opexEscalationPercent">OPEX Escalation (%/year)</Label>
                <Input
                  id="opexEscalationPercent"
                  name="opexEscalationPercent"
                  type="number"
                  step="0.1"
                  value={assumptions.opexEscalationPercent}
                  onChange={handleAssumptionChange}
                />
              </FormGroup>
              <FormGroup>
                <Label for="discountRatePercent">Discount Rate (%)</Label>
                <Input
                  id="discountRatePercent"
                  name="discountRatePercent"
                  type="number"
                  step="0.1"
                  value={assumptions.discountRatePercent}
                  onChange={handleAssumptionChange}
                />
              </FormGroup>
              <FormGroup>
                <Label for="projectLifeYears">Project Life (years)</Label>
                <Input
                  id="projectLifeYears"
                  name="projectLifeYears"
                  type="number"
                  step="1"
                  value={assumptions.projectLifeYears}
                  onChange={handleAssumptionChange}
                />
              </FormGroup>
              <FormGroup>
                <Label for="currency">Currency Code</Label>
                <Input
                  id="currency"
                  name="currency"
                  type="text"
                  value={assumptions.currency}
                  onChange={handleAssumptionChange}
                />
              </FormGroup>
              <Button color="falcon-default" block onClick={resetAssumptions}>
                Reset to Defaults
              </Button>
            </Form>
          </CardBody>
        </Card>
        <Card>
          <FalconCardHeader title="Opportunity Insights" />
          <CardBody>
            <ListGroup flush>
              {insights.map((item, index) => (
                <ListGroupItem key={index} className="px-0">
                  <Badge color="soft-primary" className="mr-2" pill>
                    {index + 1}
                  </Badge>
                  {item}
                </ListGroupItem>
              ))}
            </ListGroup>
          </CardBody>
        </Card>
      </Col>
      <Col lg={8} className="mb-3">
        <Card className="mb-3">
          <FalconCardHeader title="Financial Highlights" />
          <CardBody>
            <Row>
              {highlights.map(highlight => (
                <Col md={6} xl={4} className="mb-3" key={highlight.label}>
                  <div className="border rounded p-3 h-100">
                    <div className="text-uppercase text-600 fs--2 mb-1">{highlight.label}</div>
                    <div className="fs-1 font-weight-semi-bold text-primary">{highlight.value}</div>
                  </div>
                </Col>
              ))}
            </Row>
          </CardBody>
        </Card>
        <Card className="mb-3">
          <FalconCardHeader title="Cash Flow Projection" />
          <CardBody>
            <Line height={300} data={lineChartData} options={lineChartOptions} />
          </CardBody>
        </Card>
        <Card>
          <FalconCardHeader title="Cash Flow Table" />
          <CardBody>
            <Table responsive bordered hover size="sm" className="mb-0">
              <thead className="bg-light">
                <tr>
                  <th>Year</th>
                  <th>Generation (MWh)</th>
                  <th>Revenue</th>
                  <th>Operating Cost</th>
                  <th>Net Cash Flow</th>
                  <th>Discounted Cash Flow</th>
                  <th>Cumulative Cash Flow</th>
                </tr>
              </thead>
              <tbody>
                {analysis.table.map(row => (
                  <tr key={row.year}>
                    <td>{row.year}</td>
                    <td>{formatNumber(row.generation, 0)}</td>
                    <td>{formatCurrency(row.revenue)}</td>
                    <td>{formatCurrency(row.opex)}</td>
                    <td>{formatCurrency(row.netCash)}</td>
                    <td>{formatCurrency(row.discounted)}</td>
                    <td>{formatCurrency(row.cumulative)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </Col>
    </Row>
  );
};

export default withRedirect(InvestmentAnalysis);
