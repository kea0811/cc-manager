import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CreateProjectDialog } from '@/components/CreateProjectDialog';
import { ProjectCard } from '@/components/ProjectCard';
import { ChatPanel } from '@/components/ChatPanel';
import { EditorPanel } from '@/components/EditorPanel';
import { mockProjects, mockMessages } from './setup';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <BrowserRouter>{children}</BrowserRouter>
);

describe('UI Components', () => {
  describe('Button', () => {
    it('renders with default variant', () => {
      render(<Button>Click me</Button>);
      expect(screen.getByRole('button')).toHaveTextContent('Click me');
    });

    it('renders with different variants', () => {
      const { rerender } = render(<Button variant="destructive">Delete</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();

      rerender(<Button variant="outline">Outline</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();

      rerender(<Button variant="secondary">Secondary</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();

      rerender(<Button variant="ghost">Ghost</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();

      rerender(<Button variant="link">Link</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('renders with different sizes', () => {
      const { rerender } = render(<Button size="sm">Small</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();

      rerender(<Button size="lg">Large</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();

      rerender(<Button size="icon">I</Button>);
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('renders as child component with asChild', () => {
      render(
        <Button asChild>
          <a href="/test">Link Button</a>
        </Button>
      );
      expect(screen.getByRole('link')).toHaveTextContent('Link Button');
    });

    it('handles disabled state', () => {
      render(<Button disabled>Disabled</Button>);
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });

  describe('Input', () => {
    it('renders input element', () => {
      render(<Input placeholder="Enter text" />);
      expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
    });

    it('handles value changes', async () => {
      const user = userEvent.setup();
      render(<Input placeholder="Enter text" />);
      const input = screen.getByPlaceholderText('Enter text');
      await user.type(input, 'test');
      expect(input).toHaveValue('test');
    });

    it('supports different types', () => {
      render(<Input type="password" placeholder="Password" />);
      expect(screen.getByPlaceholderText('Password')).toHaveAttribute('type', 'password');
    });
  });

  describe('Label', () => {
    it('renders label element', () => {
      render(<Label htmlFor="test">Test Label</Label>);
      expect(screen.getByText('Test Label')).toBeInTheDocument();
    });
  });

  describe('Textarea', () => {
    it('renders textarea element', () => {
      render(<Textarea placeholder="Enter description" />);
      expect(screen.getByPlaceholderText('Enter description')).toBeInTheDocument();
    });

    it('handles value changes', async () => {
      const user = userEvent.setup();
      render(<Textarea placeholder="Enter description" />);
      const textarea = screen.getByPlaceholderText('Enter description');
      await user.type(textarea, 'test content');
      expect(textarea).toHaveValue('test content');
    });
  });

  describe('Card', () => {
    it('renders card with all subcomponents', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Title</CardTitle>
            <CardDescription>Description</CardDescription>
          </CardHeader>
          <CardContent>Content</CardContent>
          <CardFooter>Footer</CardFooter>
        </Card>
      );

      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.getByText('Description')).toBeInTheDocument();
      expect(screen.getByText('Content')).toBeInTheDocument();
      expect(screen.getByText('Footer')).toBeInTheDocument();
    });
  });

  describe('Separator', () => {
    it('renders horizontal separator', () => {
      render(<Separator data-testid="separator" />);
      expect(screen.getByTestId('separator')).toBeInTheDocument();
    });

    it('renders vertical separator', () => {
      render(<Separator orientation="vertical" data-testid="separator" />);
      expect(screen.getByTestId('separator')).toBeInTheDocument();
    });
  });

  describe('ScrollArea', () => {
    it('renders scroll area with children', () => {
      render(
        <ScrollArea>
          <div>Content</div>
        </ScrollArea>
      );
      expect(screen.getByText('Content')).toBeInTheDocument();
    });

    it('renders ScrollBar within ScrollArea', () => {
      render(
        <ScrollArea data-testid="scroll-area">
          <div style={{ height: '1000px' }}>Tall content</div>
        </ScrollArea>
      );
      expect(screen.getByTestId('scroll-area')).toBeInTheDocument();
    });

    it('applies custom className', () => {
      render(
        <ScrollArea className="custom-class" data-testid="scroll-area">
          <div>Content</div>
        </ScrollArea>
      );
      expect(screen.getByTestId('scroll-area')).toHaveClass('custom-class');
    });
  });
});

describe('CreateProjectDialog', () => {
  it('renders dialog when open', () => {
    render(
      <CreateProjectDialog open={true} onOpenChange={() => {}} onSubmit={() => {}} />
    );
    expect(screen.getByText('Create New Project')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(
      <CreateProjectDialog open={false} onOpenChange={() => {}} onSubmit={() => {}} />
    );
    expect(screen.queryByText('Create New Project')).not.toBeInTheDocument();
  });

  it('submits form with name and description', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <CreateProjectDialog open={true} onOpenChange={() => {}} onSubmit={onSubmit} />
    );

    await user.type(screen.getByLabelText('Name'), 'Test Project');
    await user.type(screen.getByLabelText('Description (optional)'), 'A description');
    await user.click(screen.getByText('Create Project'));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Test Project',
      description: 'A description',
    });
  });

  it('submits without description', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <CreateProjectDialog open={true} onOpenChange={() => {}} onSubmit={onSubmit} />
    );

    await user.type(screen.getByLabelText('Name'), 'Test Project');
    await user.click(screen.getByText('Create Project'));

    expect(onSubmit).toHaveBeenCalledWith({ name: 'Test Project', description: undefined });
  });

  it('disables submit when name is empty', () => {
    render(
      <CreateProjectDialog open={true} onOpenChange={() => {}} onSubmit={() => {}} />
    );
    expect(screen.getByText('Create Project')).toBeDisabled();
  });

  it('calls onOpenChange when cancelled', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <CreateProjectDialog open={true} onOpenChange={onOpenChange} onSubmit={() => {}} />
    );

    await user.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows loading state', () => {
    render(
      <CreateProjectDialog open={true} onOpenChange={() => {}} onSubmit={() => {}} isLoading={true} />
    );
    expect(screen.getByText('Creating...')).toBeInTheDocument();
  });
});

describe('ProjectCard', () => {
  const project = mockProjects[0];

  it('renders project information', () => {
    render(
      <ProjectCard project={project} onClick={() => {}} onDelete={() => {}} />,
      { wrapper }
    );

    expect(screen.getByText(project.name)).toBeInTheDocument();
    expect(screen.getByText(project.description!)).toBeInTheDocument();
    expect(screen.getByText(project.status)).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <ProjectCard project={project} onClick={onClick} onDelete={() => {}} />,
      { wrapper }
    );

    await user.click(screen.getByTestId('project-card'));
    expect(onClick).toHaveBeenCalled();
  });

  it('calls onDelete when delete button clicked', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();

    render(
      <ProjectCard project={project} onClick={() => {}} onDelete={onDelete} />,
      { wrapper }
    );

    await user.click(screen.getByTestId('delete-project'));
    expect(onDelete).toHaveBeenCalled();
  });

  it('renders github link when repo is set', () => {
    render(
      <ProjectCard project={mockProjects[1]} onClick={() => {}} onDelete={() => {}} />,
      { wrapper }
    );

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', mockProjects[1].githubRepo);
  });
});

describe('ChatPanel', () => {
  it('renders empty state when no messages', () => {
    render(
      <ChatPanel messages={[]} onSendMessage={() => {}} onClearChat={() => {}} />
    );
    expect(screen.getByText(/Start a conversation/)).toBeInTheDocument();
  });

  it('renders messages', () => {
    render(
      <ChatPanel messages={mockMessages} onSendMessage={() => {}} onClearChat={() => {}} />
    );

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('sends message on submit', async () => {
    const user = userEvent.setup();
    const onSendMessage = vi.fn();

    render(
      <ChatPanel messages={[]} onSendMessage={onSendMessage} onClearChat={() => {}} />
    );

    await user.type(screen.getByTestId('chat-input'), 'Test message');
    await user.click(screen.getByTestId('send-message'));

    expect(onSendMessage).toHaveBeenCalledWith('Test message');
  });

  it('sends message on Enter key', async () => {
    const user = userEvent.setup();
    const onSendMessage = vi.fn();

    render(
      <ChatPanel messages={[]} onSendMessage={onSendMessage} onClearChat={() => {}} />
    );

    const input = screen.getByTestId('chat-input');
    await user.type(input, 'Test message{enter}');

    expect(onSendMessage).toHaveBeenCalledWith('Test message');
  });

  it('clears chat when clear button clicked', async () => {
    const user = userEvent.setup();
    const onClearChat = vi.fn();

    render(
      <ChatPanel messages={mockMessages} onSendMessage={() => {}} onClearChat={onClearChat} />
    );

    await user.click(screen.getByTestId('clear-chat'));
    expect(onClearChat).toHaveBeenCalled();
  });

  it('disables clear button when no messages', () => {
    render(
      <ChatPanel messages={[]} onSendMessage={() => {}} onClearChat={() => {}} />
    );
    expect(screen.getByTestId('clear-chat')).toBeDisabled();
  });

  it('does not send empty message', async () => {
    const user = userEvent.setup();
    const onSendMessage = vi.fn();

    render(
      <ChatPanel messages={[]} onSendMessage={onSendMessage} onClearChat={() => {}} />
    );

    // Try to submit with empty input
    await user.click(screen.getByTestId('send-message'));
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('does not send message when loading', async () => {
    const user = userEvent.setup();
    const onSendMessage = vi.fn();

    render(
      <ChatPanel messages={[]} onSendMessage={onSendMessage} onClearChat={() => {}} isLoading={true} />
    );

    await user.type(screen.getByTestId('chat-input'), 'Test message');

    // Input should be disabled during loading
    expect(screen.getByTestId('chat-input')).toBeDisabled();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('allows new line with Shift+Enter', async () => {
    const user = userEvent.setup();
    const onSendMessage = vi.fn();

    render(
      <ChatPanel messages={[]} onSendMessage={onSendMessage} onClearChat={() => {}} />
    );

    const input = screen.getByTestId('chat-input');
    await user.type(input, 'Line 1{shift>}{enter}{/shift}Line 2');

    // Message should not be sent
    expect(onSendMessage).not.toHaveBeenCalled();
    // Input should contain both lines
    expect(input).toHaveValue('Line 1\nLine 2');
  });
});

describe('EditorPanel', () => {
  it('renders editor in edit mode by default', () => {
    render(
      <EditorPanel content="# Test" onChange={() => {}} onSave={() => {}} isDirty={false} />
    );
    expect(screen.getByTestId('editor-textarea')).toHaveValue('# Test');
  });

  it('switches to preview mode', async () => {
    const user = userEvent.setup();

    render(
      <EditorPanel content="# Test" onChange={() => {}} onSave={() => {}} isDirty={false} />
    );

    await user.click(screen.getByText('Preview'));
    expect(screen.getByTestId('editor-preview')).toBeInTheDocument();
  });

  it('calls onChange when content changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <EditorPanel content="" onChange={onChange} onSave={() => {}} isDirty={false} />
    );

    await user.type(screen.getByTestId('editor-textarea'), 'New content');
    expect(onChange).toHaveBeenCalled();
  });

  it('calls onSave when save button clicked', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <EditorPanel content="# Test" onChange={() => {}} onSave={onSave} isDirty={true} />
    );

    await user.click(screen.getByTestId('save-editor'));
    expect(onSave).toHaveBeenCalled();
  });

  it('disables save button when not dirty', () => {
    render(
      <EditorPanel content="# Test" onChange={() => {}} onSave={() => {}} isDirty={false} />
    );
    expect(screen.getByTestId('save-editor')).toBeDisabled();
  });

  it('shows saving state', () => {
    render(
      <EditorPanel content="# Test" onChange={() => {}} onSave={() => {}} isDirty={true} isSaving={true} />
    );
    expect(screen.getByText('Saving...')).toBeInTheDocument();
  });

  it('switches back to edit mode from preview', async () => {
    const user = userEvent.setup();

    render(
      <EditorPanel content="# Test" onChange={() => {}} onSave={() => {}} isDirty={false} />
    );

    // Switch to preview
    await user.click(screen.getByText('Preview'));
    expect(screen.getByTestId('editor-preview')).toBeInTheDocument();

    // Switch back to edit
    await user.click(screen.getByText('Edit'));
    expect(screen.getByTestId('editor-textarea')).toBeInTheDocument();
  });

  it('shows no content message in preview when empty', async () => {
    const user = userEvent.setup();

    render(
      <EditorPanel content="" onChange={() => {}} onSave={() => {}} isDirty={false} />
    );

    await user.click(screen.getByText('Preview'));
    expect(screen.getByText('No content yet')).toBeInTheDocument();
  });
});
