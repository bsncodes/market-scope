import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as endpoints from '../src/api/endpoints';
import { DashboardPage } from '../src/pages/DashboardPage';

// Leaflet needs real layout and a canvas; neither exists in jsdom, and none of
// what this file asserts lives inside the map.
vi.mock('../src/components/MarketMap', () => ({
  MarketMap: () => <div data-testid="market-map" />,
}));

const market = {
  market_id: 7,
  status: 'completed' as const,
  error: null,
  last_discovered_at: '2026-08-02T10:00:00.000Z',
  progress: null,
  boundary: { minLat: 12.97, minLng: 77.59, maxLat: 13.0, maxLng: 77.62 },
  city: { id: 1, name: 'Bengaluru', state: 'Karnataka', country: 'India' },
  categories: [{ id: 1, label: 'Supermarket' }],
};

const discovered = {
  market_id: 7,
  count: 2,
  stores: [
    {
      id: 'node/1',
      name: 'Nilgiris',
      category: 'shop=supermarket',
      lat: 12.98,
      lng: 77.6,
    },
    {
      id: 'node/2',
      name: 'Reliance Fresh',
      category: 'shop=supermarket',
      lat: 12.99,
      lng: 77.61,
    },
  ],
};

const portfolio = {
  market_id: 7,
  inside_count: 1,
  outside_count: 1,
  stores: [
    {
      id: 1,
      name: 'Our Indiranagar',
      category: 'Supermarket',
      address: null,
      is_inside: true,
      lat: 12.98,
      lng: 77.6,
    },
    {
      id: 2,
      name: 'Our Mysuru',
      category: 'Supermarket',
      address: null,
      is_inside: false,
      lat: 12.3,
      lng: 76.6,
    },
  ],
};

const renderDashboard = () =>
  render(
    <MemoryRouter initialEntries={['/markets/7']}>
      <Routes>
        <Route path="/markets/:marketId" element={<DashboardPage />} />
      </Routes>
    </MemoryRouter>,
  );

const storeList = () => screen.getAllByRole('list').at(-1)!;
const storeNames = () =>
  within(storeList())
    .queryAllByRole('listitem')
    .map((li) => li.textContent ?? '');

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.spyOn(endpoints, 'getMarket').mockResolvedValue(market);
    vi.spyOn(endpoints, 'getDiscoveredStores').mockResolvedValue(discovered);
    vi.spyOn(endpoints, 'getMarketPortfolio').mockResolvedValue(portfolio);
  });

  it('shows the city, categories and the discovery date', async () => {
    renderDashboard();

    expect(await screen.findByText(/Bengaluru market/)).toBeInTheDocument();
    expect(screen.getByText(/Karnataka, India/)).toBeInTheDocument();
    // "Discovered stores" is also a layer label, so match the dated one only.
    const dated = screen
      .getAllByText(/^Discovered/)
      .filter((el) => /\d{4}/.test(el.textContent ?? ''));
    expect(dated).toHaveLength(1);
  });

  it('starts with all three layers on and everything listed', async () => {
    renderDashboard();
    await screen.findByText(/Bengaluru market/);

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    expect(boxes.every((box) => (box as HTMLInputElement).checked)).to.equal(
      true,
    );
    await waitFor(() => expect(storeNames()).toHaveLength(4));
  });

  // These are stackable layers, not exclusive view modes: any combination has
  // to be reachable, including none of them.
  it('toggles each layer independently, down to all-off', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await screen.findByText(/Bengaluru market/);
    await waitFor(() => expect(storeNames()).toHaveLength(4));

    await user.click(
      screen.getByRole('checkbox', { name: /Discovered stores/ }),
    );
    await waitFor(() => expect(storeNames()).toHaveLength(2));
    expect(storeNames().join()).to.not.contain('Nilgiris');

    await user.click(
      screen.getByRole('checkbox', { name: /outside boundary/ }),
    );
    await waitFor(() => expect(storeNames()).toHaveLength(1));
    expect(storeNames()[0]).to.contain('Our Indiranagar');

    await user.click(screen.getByRole('checkbox', { name: /inside boundary/ }));
    await waitFor(() =>
      expect(
        screen.getByText(/No stores in the layers you have switched on/),
      ).toBeInTheDocument(),
    );
  });

  // Green against amber is exactly the pair red/green colour blindness
  // collapses, and inside vs outside is the analytical point of the screen.
  it('labels layer membership in text, not colour alone', async () => {
    renderDashboard();
    await screen.findByText(/Bengaluru market/);
    await waitFor(() => expect(storeNames()).toHaveLength(4));

    const rows = within(storeList()).getAllByRole('listitem');
    const inside = rows.find((row) =>
      row.textContent?.includes('Our Indiranagar'),
    );
    const outside = rows.find((row) => row.textContent?.includes('Our Mysuru'));

    expect(inside?.textContent).to.contain('In');
    expect(outside?.textContent).to.contain('Out');
  });

  it('renders OSM tags as words a retail analyst would use', async () => {
    renderDashboard();
    await screen.findByText(/Bengaluru market/);

    await waitFor(() =>
      expect(screen.getAllByText('Supermarket').length).to.be.greaterThan(0),
    );
    expect(screen.queryByText('shop=supermarket')).not.toBeInTheDocument();
  });

  it('surfaces a partial-failure message from the worker', async () => {
    vi.spyOn(endpoints, 'getMarket').mockResolvedValue({
      ...market,
      error: '17 areas could not be fetched, so some stores may be missing.',
    });
    renderDashboard();

    expect(
      await screen.findByText(/17 areas could not be fetched/),
    ).toBeInTheDocument();
  });

  it('shows the API error instead of an empty dashboard', async () => {
    const { ApiError } = await import('../src/api/client');
    vi.spyOn(endpoints, 'getMarket').mockRejectedValue(
      new ApiError(404, 'RESOURCE_NOT_FOUND', 'No market with id 7.'),
    );
    renderDashboard();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No market with id 7.',
    );
  });
});
