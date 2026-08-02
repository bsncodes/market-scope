import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as endpoints from '../src/api/endpoints';
import { SetupPage } from '../src/pages/SetupPage';
import { MAX_AREA_SQ_KM } from '../src/lib/boundary';
import type { Bounds } from '../src/types/api';

// Leaflet needs real layout and a canvas, neither of which jsdom has. The
// stub keeps the one thing these tests care about — that the boundary is a
// controlled value the page owns — and drops the map itself.
vi.mock('../src/components/BoundaryEditor', () => ({
  BoundaryEditor: ({
    bounds,
    onChange,
  }: {
    bounds: Bounds;
    onChange: (b: Bounds) => void;
  }) => (
    <div>
      <span data-testid="bounds">{JSON.stringify(bounds)}</span>
      <button
        type="button"
        onClick={() => onChange({ ...bounds, maxLat: bounds.maxLat + 0.05 })}
      >
        grow
      </button>
      <button
        type="button"
        onClick={() => onChange({ ...bounds, maxLat: bounds.maxLat - 0.05 })}
      >
        shrink
      </button>
    </div>
  ),
}));

// Bengaluru, as Nominatim actually returns it — about 1207 sq km, so the page
// has to shrink it before the user can submit anything.
const CITY_BBOX = {
  min_lat: 12.8334905,
  min_lng: 77.4598797,
  max_lat: 13.1426196,
  max_lng: 77.7840639,
};

const createButton = () =>
  screen.getByRole('button', { name: /create market/i });
const areaValue = () =>
  parseFloat(document.querySelector('.area-bar__value')?.textContent ?? 'NaN');

/** Options arrive asynchronously, so each one is awaited before selecting. */
async function pick(
  user: ReturnType<typeof userEvent.setup>,
  select: HTMLElement,
  value: string,
) {
  await waitFor(() =>
    expect(select.querySelector(`option[value="${value}"]`)).not.toBeNull(),
  );
  await user.selectOptions(select, value);
}

async function selectCity(user: ReturnType<typeof userEvent.setup>) {
  const [country, state, city] = screen.getAllByRole('combobox');
  await pick(user, country, '1');
  await pick(user, state, '16');
  await pick(user, city, '1187');
  await waitFor(() =>
    expect(document.querySelector('.area-bar__value')).not.toBeNull(),
  );
}

async function selectCityAndCategory(user: ReturnType<typeof userEvent.setup>) {
  await selectCity(user);
  await waitFor(() =>
    expect(
      screen.getByRole('checkbox', { name: 'Supermarket' }),
    ).toBeInTheDocument(),
  );
  await user.click(screen.getByRole('checkbox', { name: 'Supermarket' }));
}

describe('SetupPage', () => {
  beforeEach(() => {
    vi.spyOn(endpoints, 'listCountries').mockResolvedValue([
      { id: 1, name: 'India', iso_code: 'IN' },
    ]);
    vi.spyOn(endpoints, 'listStates').mockResolvedValue([
      { id: 16, name: 'Karnataka', code: 'KA' },
    ]);
    vi.spyOn(endpoints, 'listCities').mockResolvedValue([
      { id: 1187, name: 'Bengaluru' },
    ]);
    vi.spyOn(endpoints, 'listCategories').mockResolvedValue([
      { id: 1, label: 'Supermarket' },
      { id: 3, label: 'Pharmacy' },
    ]);
    vi.spyOn(endpoints, 'getCityBbox').mockResolvedValue(CITY_BBOX);
    vi.spyOn(endpoints, 'createMarket').mockResolvedValue({
      market_id: 7,
      status: 'queued',
      area_sq_km: 28.7,
    });
  });

  const renderSetup = () =>
    render(
      <MemoryRouter>
        <SetupPage />
      </MemoryRouter>,
    );

  it('locks each dropdown until its parent is chosen', async () => {
    renderSetup();
    const [, state, city] = screen.getAllByRole('combobox');

    expect(state).toBeDisabled();
    expect(city).toBeDisabled();
  });

  // A city bbox is invariably far larger than the cap, so seeding the
  // rectangle with it verbatim would land the user on a boundary they cannot
  // submit, with Create disabled and nothing explaining why.
  it('seeds the boundary from the city, shrunk under the cap', async () => {
    const user = userEvent.setup();
    renderSetup();
    await selectCityAndCategory(user);

    expect(areaValue()).to.be.greaterThan(0);
    expect(areaValue()).to.be.at.most(MAX_AREA_SQ_KM);
  });

  it('keeps Create disabled until a city and a category are both chosen', async () => {
    const user = userEvent.setup();
    renderSetup();

    expect(createButton()).toBeDisabled();
    expect(screen.getByText('Select a city to continue.')).toBeInTheDocument();

    await selectCity(user);

    await waitFor(() =>
      expect(
        screen.getByText('Select at least one store category.'),
      ).toBeInTheDocument(),
    );
    expect(createButton()).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Supermarket' }));
    await waitFor(() => expect(createButton()).toBeEnabled());
  });

  // The behaviour the brief names: the cap has to disable the button, not just
  // colour a number red.
  it('disables Create once the boundary goes over the cap', async () => {
    const user = userEvent.setup();
    renderSetup();
    await selectCityAndCategory(user);
    await waitFor(() => expect(createButton()).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'grow' }));

    await waitFor(() => expect(areaValue()).to.be.greaterThan(MAX_AREA_SQ_KM));
    expect(createButton()).toBeDisabled();
    expect(
      screen.getByText(`The boundary must be ${MAX_AREA_SQ_KM} sq km or less.`),
    ).toBeInTheDocument();
  });

  it('re-enables Create when the boundary comes back under the cap', async () => {
    const user = userEvent.setup();
    renderSetup();
    await selectCityAndCategory(user);

    await user.click(screen.getByRole('button', { name: 'grow' }));
    await waitFor(() => expect(createButton()).toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'shrink' }));

    await waitFor(() => expect(areaValue()).to.be.at.most(MAX_AREA_SQ_KM));
    expect(createButton()).toBeEnabled();
  });

  it('flags the over-cap area visually as well as disabling the button', async () => {
    const user = userEvent.setup();
    renderSetup();
    await selectCityAndCategory(user);
    await user.click(screen.getByRole('button', { name: 'grow' }));

    await waitFor(() =>
      expect(document.querySelector('.area-bar--over')).toBeInTheDocument(),
    );
  });

  it('submits the boundary the map is actually showing', async () => {
    const user = userEvent.setup();
    renderSetup();
    await selectCityAndCategory(user);
    await waitFor(() => expect(createButton()).toBeEnabled());

    const shown = JSON.parse(screen.getByTestId('bounds').textContent ?? '{}');
    await user.click(createButton());

    await waitFor(() => expect(endpoints.createMarket).toHaveBeenCalled());
    expect(endpoints.createMarket).toHaveBeenCalledWith({
      cityId: 1187,
      categoryIds: [1],
      boundary: shown,
    });
  });

  it('shows the server rejection rather than failing silently', async () => {
    const { ApiError } = await import('../src/api/client');
    vi.spyOn(endpoints, 'createMarket').mockRejectedValue(
      new ApiError(
        400,
        'REQUEST_VALIDATION_FAILED',
        'Boundary covers 40.00 sq km.',
      ),
    );

    const user = userEvent.setup();
    renderSetup();
    await selectCityAndCategory(user);
    await waitFor(() => expect(createButton()).toBeEnabled());
    await user.click(createButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Boundary covers 40.00 sq km.',
    );
  });
});
