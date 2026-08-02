import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ApiError } from '../api/client';
import {
  createMarket,
  getCityBbox,
  listCategories,
  listCities,
  listCountries,
  listStates,
} from '../api/endpoints';
import { BoundaryEditor } from '../components/BoundaryEditor';
import { ErrorBox } from '../components/ErrorBox';
import { Layout } from '../components/Layout';
import { asApiError, useRequest } from '../hooks/useRequest';
import { useThrottledValue } from '../hooks/useThrottledValue';
import {
  areaSqKm,
  fromCityBbox,
  MAX_AREA_SQ_KM,
  shrinkToLimit,
} from '../lib/boundary';
import type { Bounds } from '../types/api';

const AREA_THROTTLE_MS = 120;

export function SetupPage() {
  const navigate = useNavigate();

  const [countryId, setCountryId] = useState<number | null>(null);
  const [stateId, setStateId] = useState<number | null>(null);
  const [cityId, setCityId] = useState<number | null>(null);
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Both are needed before anything can be selected and neither depends on the
  // other, so they are issued together rather than one after the next.
  const countries = useRequest(listCountries, []);
  const categories = useRequest(listCategories, []);

  const states = useRequest(countryId ? () => listStates(countryId) : null, [
    countryId,
  ]);
  const cities = useRequest(stateId ? () => listCities(stateId) : null, [
    stateId,
  ]);
  const bbox = useRequest(cityId ? () => getCityBbox(cityId) : null, [cityId]);

  // The city's own bbox is the starting rectangle, shrunk to something the user
  // can actually submit — a city is invariably far bigger than 30 sq km.
  useEffect(() => {
    setBounds(bbox.data ? shrinkToLimit(fromCityBbox(bbox.data)) : null);
  }, [bbox.data]);

  // Falls back to the live bounds until the throttled copy catches up. Without
  // that, the frame in which the rectangle first appears reads "0.00 sq km" —
  // and a zero area is under the cap, so Create is briefly enabled on a number
  // that is not the boundary's.
  const throttled = useThrottledValue(bounds, AREA_THROTTLE_MS);
  const measured = throttled ?? bounds;
  const area = useMemo(() => (measured ? areaSqKm(measured) : 0), [measured]);
  const overLimit = area > MAX_AREA_SQ_KM;

  const ready =
    cityId !== null && categoryIds.length > 0 && bounds !== null && !overLimit;

  async function submit() {
    if (!ready || !bounds || cityId === null) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const { market_id } = await createMarket({
        cityId,
        categoryIds,
        boundary: bounds,
      });
      navigate(`/markets/${market_id}/status`);
    } catch (err) {
      setSubmitError(asApiError(err));
      setSubmitting(false);
    }
  }

  const loadError =
    countries.error ?? categories.error ?? states.error ?? cities.error;

  return (
    <Layout
      step={1}
      title="Define your market"
      subtitle="Pick a city and the store categories to look for, then size the boundary. Drag the centre handle to move the rectangle and the corners to resize it."
    >
      {loadError && <ErrorBox error={loadError} />}

      <div className="setup">
        <aside className="setup__panel">
          <label className="field">
            <span className="field__label">Country</span>
            <select
              className="field__control"
              value={countryId ?? ''}
              disabled={countries.loading}
              onChange={(event) => {
                setCountryId(Number(event.target.value) || null);
                setStateId(null);
                setCityId(null);
              }}
            >
              <option value="">Select a country…</option>
              {countries.data?.map((country) => (
                <option key={country.id} value={country.id}>
                  {country.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">State</span>
            <select
              className="field__control"
              value={stateId ?? ''}
              disabled={!countryId || states.loading}
              onChange={(event) => {
                setStateId(Number(event.target.value) || null);
                setCityId(null);
              }}
            >
              <option value="">
                {countryId ? 'Select a state…' : 'Pick a country first'}
              </option>
              {states.data?.map((state) => (
                <option key={state.id} value={state.id}>
                  {state.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">City</span>
            <select
              className="field__control"
              value={cityId ?? ''}
              disabled={!stateId || cities.loading}
              onChange={(event) =>
                setCityId(Number(event.target.value) || null)
              }
            >
              <option value="">
                {stateId ? 'Select a city…' : 'Pick a state first'}
              </option>
              {cities.data?.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="field">
            <legend className="field__label">Store categories</legend>
            <div className="checklist">
              {categories.data?.map((category) => (
                <label key={category.id} className="checklist__item">
                  <input
                    type="checkbox"
                    checked={categoryIds.includes(category.id)}
                    onChange={(event) =>
                      setCategoryIds((current) =>
                        event.target.checked
                          ? [...current, category.id]
                          : current.filter((id) => id !== category.id),
                      )
                    }
                  />
                  {category.label}
                </label>
              ))}
            </div>
          </fieldset>
        </aside>

        <section className="setup__map">
          {bbox.loading && (
            <div className="map-placeholder">Locating the city…</div>
          )}
          {bbox.error && <ErrorBox error={bbox.error} />}
          {!cityId && !bbox.loading && (
            <div className="map-placeholder">
              Select a country, state and city to place the boundary.
            </div>
          )}

          {bounds && cityId && (
            <>
              <BoundaryEditor
                bounds={bounds}
                onChange={setBounds}
                recentreToken={cityId}
                overLimit={overLimit}
              />

              <div
                className={overLimit ? 'area-bar area-bar--over' : 'area-bar'}
              >
                <span className="area-bar__value">{area.toFixed(2)} sq km</span>
                <span className="area-bar__limit">
                  limit {MAX_AREA_SQ_KM} sq km
                </span>
                {overLimit && (
                  <span className="area-bar__hint">
                    Too large — drag a corner inward to shrink the boundary
                    before you can create the market.
                  </span>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {submitError && <ErrorBox error={submitError} />}

      <div className="actions">
        <button
          type="button"
          className="button button--primary"
          disabled={!ready || submitting}
          onClick={submit}
        >
          {submitting ? 'Creating…' : 'Create market'}
        </button>
        <span className="footnote">
          {disabledReason(cityId, categoryIds, overLimit)}
        </span>
      </div>
    </Layout>
  );
}

/** A disabled button with no explanation is the thing users get stuck on. */
function disabledReason(
  cityId: number | null,
  categoryIds: number[],
  overLimit: boolean,
): string {
  if (cityId === null) return 'Select a city to continue.';
  if (categoryIds.length === 0) return 'Select at least one store category.';
  if (overLimit) return `The boundary must be ${MAX_AREA_SQ_KM} sq km or less.`;
  return 'Ready to discover.';
}
