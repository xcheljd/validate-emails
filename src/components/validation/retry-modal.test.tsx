import { render, screen, fireEvent } from '@testing-library/react';
import { RetryModal } from './retry-modal';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';

describe('RetryModal', () => {
    it('should render when open', () => {
        render(
            <RetryModal 
                open={true} 
                unknownCount={5} 
                onRetry={vi.fn()} 
                onCancel={vi.fn()} 
            />
        );
        expect(screen.getByText('Validation Complete')).toBeInTheDocument();
        expect(screen.getByText(/We found 5 Unknown results/)).toBeInTheDocument();
    });

    it('should call onRetry when retry button is clicked', () => {
        const onRetry = vi.fn();
        render(
            <RetryModal 
                open={true} 
                unknownCount={5} 
                onRetry={onRetry} 
                onCancel={vi.fn()} 
            />
        );
        fireEvent.click(screen.getByText('Retry Unknown Emails'));
        expect(onRetry).toHaveBeenCalled();
    });
});
