import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client';
import { BoundaryFields } from '../src/components/BoundaryFields';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { ErrorBox } from '../src/components/ErrorBox';
import type { Bounds } from '../src/types/api';

describe('ErrorBox', () => {
  it('shows the server message', () => {
    render(
      <ErrorBox
        error={new ApiError(404, 'RESOURCE_NOT_FOUND', 'No market with id 9.')}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('No market with id 9.');
  });

  // The upload endpoint rejects a whole file but names every bad row. Folding
  // that into the summary would discard the only part that says what to fix.
  it('renders one row per CSV problem', () => {
    render(
      <ErrorBox
        error={
          new ApiError(
            422,
            'RESOURCE_VALIDATION_FAILED',
            'File rejected: 2 invalid rows.',
            {
              error_count: 2,
              truncated: false,
              errors: [
                {
                  row: 2,
                  column: 'store_name',
                  message: 'store_name is required.',
                },
                {
                  row: 5,
                  column: 'latitude',
                  message: 'latitude must be a number.',
                },
              ],
            },
          )
        }
      />,
    );

    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2
    expect(screen.getByText('store_name is required.')).toBeInTheDocument();
    expect(screen.getByText('latitude must be a number.')).toBeInTheDocument();
  });

  it('says when the row list was truncated', () => {
    render(
      <ErrorBox
        error={
          new ApiError(422, 'RESOURCE_VALIDATION_FAILED', 'File rejected.', {
            error_count: 120,
            truncated: true,
            errors: [{ row: 2, message: 'bad' }],
          })
        }
      />,
    );

    expect(screen.getByText(/Showing the first 1 of 120/)).toBeInTheDocument();
  });

  it('lists the expected columns when headers were wrong', () => {
    render(
      <ErrorBox
        error={
          new ApiError(
            422,
            'RESOURCE_VALIDATION_FAILED',
            'Missing required column: city.',
            {
              expected: ['store_name', 'address', 'city'],
            },
          )
        }
      />,
    );

    expect(screen.getByText(/store_name, address, city/)).toBeInTheDocument();
  });

  it('renders a bare error without a details table', () => {
    render(
      <ErrorBox
        error={
          new ApiError(0, 'NETWORK_UNREACHABLE', 'Could not reach the API.')
        }
      />,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('ErrorBoundary', () => {
  const Boom = () => {
    throw new Error('map exploded');
  };

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>all fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('all fine')).toBeInTheDocument();
  });

  // Without this the whole tree unmounts and the user gets a blank white page
  // with the reason only in the console.
  it('catches a render error instead of blanking the page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('map exploded');
    expect(screen.getByRole('link', { name: /reload/i })).toBeInTheDocument();
  });
});

describe('BoundaryFields', () => {
  const bounds: Bounds = {
    minLat: 12.9786,
    minLng: 77.5451,
    maxLat: 13.0274,
    maxLng: 77.5949,
  };

  // The Leaflet handles are non-focusable divIcons, so this is the only
  // keyboard route to the one interaction the whole flow turns on.
  it('exposes all four edges as labelled inputs', () => {
    render(<BoundaryFields bounds={bounds} onChange={() => {}} />);

    for (const edge of ['South', 'North', 'West', 'East']) {
      expect(screen.getByLabelText(new RegExp(`^${edge}`))).toBeInTheDocument();
    }
  });

  it('commits an edited edge on Enter', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BoundaryFields bounds={bounds} onChange={onChange} />);

    const north = screen.getByLabelText(/^North/);
    await user.clear(north);
    await user.type(north, '13.01{Enter}');

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ maxLat: 13.01 }),
    );
  });

  it('commits on blur as well, so a click away is not lost', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BoundaryFields bounds={bounds} onChange={onChange} />);

    const south = screen.getByLabelText(/^South/);
    await user.clear(south);
    await user.type(south, '12.99');
    await user.tab();

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ minLat: 12.99 }),
    );
  });

  // Committing per keystroke would collapse the rectangle under the caret the
  // moment someone typed "12." on the way to "12.99".
  it('does not commit while the value is still being typed', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BoundaryFields bounds={bounds} onChange={onChange} />);

    await user.clear(screen.getByLabelText(/^North/));
    await user.type(screen.getByLabelText(/^North/), '13.');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('normalises an edge dragged past its opposite', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BoundaryFields bounds={bounds} onChange={onChange} />);

    const north = screen.getByLabelText(/^North/);
    await user.clear(north);
    await user.type(north, '12.0{Enter}');

    const next = onChange.mock.calls[0][0] as Bounds;
    expect(next.minLat).to.be.lessThan(next.maxLat);
  });

  it('ignores a value that is not a number', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<BoundaryFields bounds={bounds} onChange={onChange} />);

    const east = screen.getByLabelText(/^East/);
    await user.clear(east);
    await user.tab();

    expect(onChange).not.toHaveBeenCalled();
  });
});
